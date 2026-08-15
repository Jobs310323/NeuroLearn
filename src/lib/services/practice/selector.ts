import { and, eq, gt, inArray } from 'drizzle-orm';

import { db } from '@/lib/db';
import { assessments, knowledgeNodes, learningPaths, nodeEdges, userResponses } from '@/lib/db/schema';
import type { practiceModeEnum } from '@/lib/db/schema/enums';
import type { AssessmentPayload } from '@/lib/db/schema/types';

type PracticeMode = (typeof practiceModeEnum.enumValues)[number];

/**
 * Подбор набора заданий. Ядро интерливинга — `docs/API.md` §3.
 *
 * Правила:
 * 1. При `mix=true` пул = узел-якорь + узлы по рёбрам `related`/`contrast`/
 *    `analogous`, взвешенно по `strength`; доля смеси = `interleaveRatio`.
 * 2. Два задания из одной `variant_group_id` в один набор не попадают.
 * 3. Задания, отвеченные верно за последние 24 часа, исключаются.
 * 4. Порядок перемешан так, что подряд не идут два вопроса одного узла.
 * 5. `correct_answer` наружу не отдаётся никогда.
 */

export type PracticeQueueItem = {
  assessmentId: string;
  nodeId: string;
  nodeTitle: string;
  type: string;
  cognitiveLevel: string;
  prompt: string;
  payload: AssessmentPayload;
  feedbackMode: 'instant' | 'delayed';
  targetResponseMs: number | null;
  interleaved: boolean;
};

export type PracticeQueue = {
  items: PracticeQueueItem[];
  sourceNodeIds: string[];
  interleaveRatio: number;
};

const ANCHOR_ONLY_RATIO = 0;

export async function buildPracticeQueue(params: {
  userId: string;
  nodeId: string;
  mix: boolean;
  limit: number;
  mode: PracticeMode;
  interleaveRatio: number;
}): Promise<PracticeQueue | null> {
  const anchor = await db
    .select({ id: knowledgeNodes.id, title: knowledgeNodes.title, pathId: knowledgeNodes.pathId })
    .from(knowledgeNodes)
    .innerJoin(learningPaths, eq(learningPaths.id, knowledgeNodes.pathId))
    .where(and(eq(knowledgeNodes.id, params.nodeId), eq(learningPaths.userId, params.userId)))
    .limit(1);
  const anchorNode = anchor[0];
  if (!anchorNode) return null;

  const interleaveRatio = params.mix ? params.interleaveRatio : ANCHOR_ONLY_RATIO;

  const neighborEdges = params.mix
    ? await db
        .select({ targetId: nodeEdges.targetId, strength: nodeEdges.strength, title: knowledgeNodes.title })
        .from(nodeEdges)
        .innerJoin(knowledgeNodes, eq(knowledgeNodes.id, nodeEdges.targetId))
        .where(
          and(
            eq(nodeEdges.sourceId, params.nodeId),
            inArray(nodeEdges.relation, ['related', 'contrast', 'analogous']),
          ),
        )
    : [];

  const nodeTitleById = new Map<string, string>([[anchorNode.id, anchorNode.title]]);
  for (const edge of neighborEdges) nodeTitleById.set(edge.targetId, edge.title);

  const sourceNodeIds = [anchorNode.id, ...neighborEdges.map((e) => e.targetId)];

  const recentlyCorrect = await db
    .select({ assessmentId: userResponses.assessmentId })
    .from(userResponses)
    .where(
      and(
        eq(userResponses.userId, params.userId),
        inArray(userResponses.nodeId, sourceNodeIds),
        eq(userResponses.isCorrect, true),
        gt(userResponses.createdAt, new Date(Date.now() - 24 * 60 * 60 * 1000)),
      ),
    );
  const excluded = new Set(recentlyCorrect.map((r) => r.assessmentId));

  const rows = await db
    .select({
      id: assessments.id,
      nodeId: assessments.nodeId,
      type: assessments.type,
      cognitiveLevel: assessments.cognitiveLevel,
      prompt: assessments.prompt,
      payload: assessments.payload,
      feedbackMode: assessments.feedbackMode,
      targetResponseMs: assessments.targetResponseMs,
      variantGroupId: assessments.variantGroupId,
    })
    .from(assessments)
    .where(and(inArray(assessments.nodeId, sourceNodeIds), eq(assessments.active, true)));

  const eligible = rows.filter((row) => !excluded.has(row.id));
  const anchorPool = shuffle(eligible.filter((row) => row.nodeId === anchorNode.id));
  const neighborStrength = new Map(neighborEdges.map((e) => [e.targetId, e.strength]));
  const neighborPool = weightedShuffle(
    eligible.filter((row) => row.nodeId !== anchorNode.id),
    (row) => neighborStrength.get(row.nodeId) ?? 0.5,
  );

  const targetInterleaved = params.mix ? Math.round(params.limit * interleaveRatio) : 0;

  const picked: typeof rows = [];
  const usedGroups = new Set<string>();

  function take(pool: typeof rows, count: number): number {
    let takenCount = 0;
    for (const row of pool) {
      if (takenCount >= count || picked.length >= params.limit) break;
      if (row.variantGroupId && usedGroups.has(row.variantGroupId)) continue;
      picked.push(row);
      if (row.variantGroupId) usedGroups.add(row.variantGroupId);
      takenCount += 1;
    }
    return takenCount;
  }

  const neighborTaken = take(neighborPool, targetInterleaved);
  take(anchorPool, params.limit - neighborTaken);
  // Пул якоря исчерпан раньше лимита — добираем смежными, даже если это
  // превышает исходную долю смеси (лучше полный набор, чем недобор).
  if (picked.length < params.limit) take(neighborPool.slice(neighborTaken), params.limit - picked.length);

  const ordered = spreadByNode(picked);

  const items: PracticeQueueItem[] = ordered.map((row) => ({
    assessmentId: row.id,
    nodeId: row.nodeId,
    nodeTitle: nodeTitleById.get(row.nodeId) ?? '',
    type: row.type,
    cognitiveLevel: row.cognitiveLevel,
    prompt: row.prompt,
    payload: row.payload,
    feedbackMode: row.feedbackMode,
    targetResponseMs: row.targetResponseMs,
    interleaved: row.nodeId !== anchorNode.id,
  }));

  return { items, sourceNodeIds, interleaveRatio };
}

function shuffle<T>(items: T[]): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j] as T, copy[i] as T];
  }
  return copy;
}

/** Взвешенная перестановка (без повторов): вероятность выбора пропорциональна весу. */
function weightedShuffle<T>(items: T[], weightOf: (item: T) => number): T[] {
  const pool = items.map((item) => ({ item, key: Math.random() ** (1 / Math.max(weightOf(item), 0.01)) }));
  pool.sort((a, b) => b.key - a.key);
  return pool.map((p) => p.item);
}

/** Переупорядочивает так, чтобы подряд не шли два задания одного узла (когда это возможно). */
function spreadByNode<T extends { nodeId: string }>(items: T[]): T[] {
  const byNode = new Map<string, T[]>();
  for (const item of items) {
    const bucket = byNode.get(item.nodeId) ?? [];
    bucket.push(item);
    byNode.set(item.nodeId, bucket);
  }
  const buckets = [...byNode.values()];
  const result: T[] = [];
  let lastNodeId: string | null = null;
  while (result.length < items.length) {
    buckets.sort((a, b) => b.length - a.length);
    const bucket = buckets.find((b) => b.length > 0 && b[0]?.nodeId !== lastNodeId) ?? buckets.find((b) => b.length > 0);
    if (!bucket) break;
    const next = bucket.shift();
    if (!next) break;
    result.push(next);
    lastNodeId = next.nodeId;
  }
  return result;
}
