import { and, desc, eq, inArray } from 'drizzle-orm';

import { db } from '@/lib/db';
import { assessments, knowledgeNodes, userResponses } from '@/lib/db/schema';

import type { ContextScope } from '../context';
import { writeContext } from '../context';
import { PROGRESS_ANALYZER_PROMPT } from '../prompts';
import { generateValidated } from '../generate';
import { progressAnalysisSchema } from '../schemas';

/**
 * ProgressAnalyzer: превращает сырую телеметрию `user_responses` в срез
 * на общей доске агентов. Ничего не решает сам — только пишет факты,
 * которые читают Tutor и MetacognitiveCoach при сборке промпта.
 *
 * Минимум данных для анализа: меньше MIN_RESPONSES ответов — вывод модели
 * ненадёжен (см. правило "если данных мало, оставь списки пустыми" в
 * промпте), поэтому вызов LLM вообще не делается — это просто трата
 * бесплатного лимита без пользы.
 */

const MIN_RESPONSES = 5;
const RESPONSE_LIMIT = 200;

type ResponseRow = {
  nodeId: string;
  nodeTitle: string;
  isCorrect: boolean;
  partialScore: number;
  responseTimeMs: number;
  confidenceLevel: number | null;
  cognitiveLevel: string;
};

export async function analyzeProgress(params: {
  userId: string;
  scope: ContextScope;
}): Promise<{ skipped: true } | { skipped: false; generationId: string }> {
  const rows = await collectResponses(params.userId, params.scope);
  if (rows.length < MIN_RESPONSES) return { skipped: true };

  const prompt = summarizeForPrompt(rows);

  const { data, generationId } = await generateValidated({
    agent: 'progress_analyzer',
    operation: 'analyze_progress',
    userId: params.userId,
    system: PROGRESS_ANALYZER_PROMPT,
    prompt,
    schema: progressAnalysisSchema,
    maxOutputTokens: 2000,
  });

  const nodeIdByTitle = new Map(rows.map((row) => [row.nodeTitle, row.nodeId]));
  const recommendedFocusNodeIds = data.recommendedFocus
    .map((focus) => nodeIdByTitle.get(focus))
    .filter((id): id is string => Boolean(id));

  await writeContext(params.userId, 'progress_analyzer', params.scope, {
    summary: data.summary,
    facts: {
      strengths: data.strengths,
      gaps: data.gaps,
      misconceptions: data.misconceptions.map((m) => ({
        statement: m.statement,
        evidenceResponseIds: [],
      })),
      recommendedFocusNodeIds,
      notes: '',
    },
  });

  return { skipped: false, generationId };
}

async function collectResponses(userId: string, scope: ContextScope): Promise<ResponseRow[]> {
  const conditions = [eq(userResponses.userId, userId)];

  if (scope.scope === 'node') {
    conditions.push(eq(userResponses.nodeId, scope.nodeId));
  } else if (scope.scope === 'path') {
    const pathNodes = await db
      .select({ id: knowledgeNodes.id })
      .from(knowledgeNodes)
      .where(eq(knowledgeNodes.pathId, scope.pathId));
    const nodeIds = pathNodes.map((n) => n.id);
    if (nodeIds.length === 0) return [];
    conditions.push(inArray(userResponses.nodeId, nodeIds));
  }

  return db
    .select({
      nodeId: userResponses.nodeId,
      nodeTitle: knowledgeNodes.title,
      isCorrect: userResponses.isCorrect,
      partialScore: userResponses.partialScore,
      responseTimeMs: userResponses.responseTimeMs,
      confidenceLevel: userResponses.confidenceLevel,
      cognitiveLevel: assessments.cognitiveLevel,
    })
    .from(userResponses)
    .innerJoin(knowledgeNodes, eq(knowledgeNodes.id, userResponses.nodeId))
    .innerJoin(assessments, eq(assessments.id, userResponses.assessmentId))
    .where(and(...conditions))
    .orderBy(desc(userResponses.createdAt))
    .limit(RESPONSE_LIMIT);
}

/** Агрегаты по узлам вместо сырых ответов — иначе промпт не влезет в бюджет. */
function summarizeForPrompt(rows: ResponseRow[]): string {
  const byNode = new Map<string, ResponseRow[]>();
  for (const row of rows) {
    const list = byNode.get(row.nodeTitle);
    if (list) list.push(row);
    else byNode.set(row.nodeTitle, [row]);
  }

  const lines = [...byNode.entries()].map(([title, nodeRows]) => {
    const accuracy = mean(nodeRows.map((r) => (r.isCorrect ? 1 : r.partialScore)));
    const avgTimeMs = mean(nodeRows.map((r) => r.responseTimeMs));
    const confidences = nodeRows
      .map((r) => r.confidenceLevel)
      .filter((c): c is number => c !== null);
    const deep = nodeRows.filter((r) =>
      ['apply', 'analyze', 'evaluate', 'create'].includes(r.cognitiveLevel),
    );
    const deepAccuracy = deep.length > 0 ? mean(deep.map((r) => (r.isCorrect ? 1 : r.partialScore))) : null;

    const calibration =
      confidences.length > 0
        ? mean(confidences.map((c) => c / 5)) -
          mean(
            nodeRows
              .filter((r) => r.confidenceLevel !== null)
              .map((r) => (r.isCorrect ? 1 : r.partialScore)),
          )
        : null;

    return [
      `- ${title}: ${nodeRows.length} попыток, точность ${pct(accuracy)}`,
      `  среднее время ${Math.round(avgTimeMs)}мс`,
      deepAccuracy !== null ? `, точность на apply+ ${pct(deepAccuracy)}` : '',
      calibration !== null ? `, калибровка ${calibration >= 0 ? '+' : ''}${calibration.toFixed(2)}` : '',
    ].join('');
  });

  return [
    `Всего ответов в выборке: ${rows.length}.`,
    `Калибровка: положительное значение — переоценка себя, отрицательное — недооценка.`,
    'По узлам:',
    ...lines,
  ].join('\n');
}

function mean(values: number[]): number {
  return values.length === 0 ? 0 : values.reduce((a, b) => a + b, 0) / values.length;
}

function pct(value: number): string {
  return `${Math.round(value * 100)}%`;
}
