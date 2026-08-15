import { and, count, desc, eq, gt, inArray, sql } from 'drizzle-orm';

import { db } from '@/lib/db';
import {
  assessments,
  knowledgeNodes,
  nodeProgress,
  projectSubmissions,
  reflections,
  reviewLogs,
  userResponses,
} from '@/lib/db/schema';
import { ensureCard } from '@/lib/services/fsrs/engine';
import { rowToCard } from '@/lib/services/fsrs/mapping';
import { fsrs, generatorParameters } from 'ts-fsrs';

import { nextNodeStatus, type NodeStatus } from '../../services/practice/transitions';

const RESPONSE_WINDOW = 20;

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? ((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2 : (sorted[mid] as number);
}

function calendarDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export type ProgressUpdate = {
  nodeId: string;
  statusBefore: NodeStatus;
  statusAfter: NodeStatus;
  knowledgeStrength: number;
  automaticityIndex: number;
  nextReviewAt: string | null;
};

/**
 * Пересчёт `node_progress` и переход статуса узла — формулы из `PRD.md` §5.
 * Вызывается при завершении сессии практики (`POST /sessions/:id/complete`)
 * для каждого узла, по которому в сессии были ответы.
 */
export async function recomputeNodeProgress(
  userId: string,
  nodeId: string,
  now: Date = new Date(),
): Promise<ProgressUpdate> {
  const node = await db.query.knowledgeNodes.findFirst({ where: eq(knowledgeNodes.id, nodeId) });
  if (!node) throw new Error('Узел не найден.');

  const recent = await db
    .select({
      isCorrect: userResponses.isCorrect,
      partialScore: userResponses.partialScore,
      responseTimeMs: userResponses.responseTimeMs,
      createdAt: userResponses.createdAt,
      cognitiveLevel: assessments.cognitiveLevel,
      targetResponseMs: assessments.targetResponseMs,
    })
    .from(userResponses)
    .innerJoin(assessments, eq(assessments.id, userResponses.assessmentId))
    .where(and(eq(userResponses.userId, userId), eq(userResponses.nodeId, nodeId)))
    .orderBy(desc(userResponses.createdAt))
    .limit(RESPONSE_WINDOW);

  const hasAnyResponse = recent.length > 0;
  const hasPreAssessmentResponse = await hasPreAssessmentAnswer(userId, nodeId);

  // A — точность, взвешенная по свежести (новее -> больше вес).
  const n = recent.length;
  const accuracy =
    n === 0
      ? 0
      : recent.reduce((sum, r, i) => sum + r.partialScore * (n - i), 0) /
        recent.reduce((sum, _r, i) => sum + (n - i), 0);

  // R — вероятность вспомнить сейчас, из FSRS-карточки узла.
  const card = await ensureCard(userId, nodeId);
  const engine = fsrs(generatorParameters({ request_retention: 0.9 }));
  const retrievability = card.reps > 0 ? engine.get_retrievability(rowToCard(card), now, false) : 0;

  // S — скорость относительно целевого времени.
  const responseTimes = recent.map((r) => r.responseTimeMs);
  const targetTimes = recent.map((r) => r.targetResponseMs).filter((t): t is number => t != null);
  const medianResponseMs = median(responseTimes);
  const medianTargetMs = median(targetTimes);
  const speed =
    medianResponseMs && medianTargetMs
      ? clamp(medianTargetMs / medianResponseMs, 0, 1)
      : 0;

  // C — доля уровней Блума среди заданных для узла, по которым уже есть ответ.
  const activeAssessments = await db
    .select({ cognitiveLevel: assessments.cognitiveLevel })
    .from(assessments)
    .where(and(eq(assessments.nodeId, nodeId), eq(assessments.active, true)));
  const assignedLevels = new Set(activeAssessments.map((a) => a.cognitiveLevel));
  const coveredLevels = new Set(recent.map((r) => r.cognitiveLevel));
  const coverage = assignedLevels.size === 0 ? 0 : coveredLevels.size / assignedLevels.size;

  const knowledgeStrength = Math.round(
    clamp(100 * (0.35 * retrievability + 0.3 * accuracy + 0.2 * speed + 0.15 * coverage), 0, 100),
  );

  // Автоматизм: доля верных-и-быстрых ответов среди верных.
  // personalBaseline — упрощение относительно PRD (там per-cognitive-level):
  // медиана времени по всем верным ответам пользователя за всё время —
  // защищено от одной сессии, не требует отдельного индекса по уровню.
  const personalBaseline = await personalResponseBaseline(userId);
  const correct = recent.filter((r) => r.isCorrect);
  const correctAndFast = correct.filter((r) => {
    const threshold = Math.min(r.targetResponseMs ?? Infinity, 1.3 * (personalBaseline ?? Infinity));
    return Number.isFinite(threshold) ? r.responseTimeMs <= threshold : false;
  });
  const automaticityIndex = correct.length === 0 ? 0 : correctAndFast.length / correct.length;

  const distinctPracticeDays = new Set(recent.map((r) => calendarDay(r.createdAt))).size;

  const hasPostModuleReflection = await db.query.reflections
    .findFirst({ where: and(eq(reflections.nodeId, nodeId), eq(reflections.type, 'post_module')) })
    .then((row) => Boolean(row));

  const longReviews = await db
    .select({ scheduledDays: reviewLogs.scheduledDays, rating: reviewLogs.rating })
    .from(reviewLogs)
    .where(eq(reviewLogs.cardId, card.id));
  const successfulLongReviews = longReviews.filter(
    (r) => r.scheduledDays >= 7 && r.rating !== 'again',
  ).length;

  const interleavedRecent = await db
    .select({ isCorrect: userResponses.isCorrect })
    .from(userResponses)
    .where(and(eq(userResponses.userId, userId), eq(userResponses.nodeId, nodeId)))
    .orderBy(desc(userResponses.createdAt))
    .limit(RESPONSE_WINDOW);
  const interleavedAccuracy =
    interleavedRecent.length === 0
      ? null
      : interleavedRecent.filter((r) => r.isCorrect).length / interleavedRecent.length;

  // Нужен до сборки facts: гэп из защиты проекта считается «непогашенным»,
  // только если вскрыт ПОСЛЕ того, как узел уже получил mastered/automated —
  // иначе устаревшая запись из прошлого раунда защиты держала бы узел
  // в has_gaps бесконечно.
  const existing = await db.query.nodeProgress.findFirst({ where: eq(nodeProgress.nodeId, nodeId) });
  const hasGapFromProjectDefense = await hasUnresolvedDefenseGap(
    nodeId,
    existing?.masteredAt ?? existing?.automatedAt ?? null,
  );

  const facts = {
    hasAnyResponse,
    hasPreAssessmentResponse,
    responseCount: recent.length,
    accuracy,
    knowledgeStrength,
    hasPostModuleReflection,
    distinctPracticeDays,
    automaticityIndex,
    successfulLongReviews,
    interleavedAccuracy,
    cardDuePast: card.due.getTime() <= now.getTime(),
    hasGapFromProjectDefense,
  };

  const statusBefore = node.status;
  const statusAfter = nextNodeStatus(statusBefore, facts);

  const totalRepsRows = await db
    .select({ value: count() })
    .from(userResponses)
    .where(and(eq(userResponses.userId, userId), eq(userResponses.nodeId, nodeId)));
  const totalReps = totalRepsRows[0]?.value ?? 0;

  const firstStudiedAt = existing?.firstStudiedAt ?? (hasAnyResponse ? now : null);
  const masteredAt =
    existing?.masteredAt ?? (statusAfter === 'mastered' && statusBefore !== 'mastered' ? now : null);
  const automatedAt =
    existing?.automatedAt ?? (statusAfter === 'automated' && statusBefore !== 'automated' ? now : null);
  const timeToMasterySeconds =
    existing?.timeToMasterySeconds ??
    (automatedAt && firstStudiedAt
      ? Math.round((automatedAt.getTime() - firstStudiedAt.getTime()) / 1000)
      : null);

  await db
    .insert(nodeProgress)
    .values({
      nodeId,
      userId,
      knowledgeStrength,
      automaticityIndex,
      accuracyRate: accuracy,
      medianResponseTimeMs: medianResponseMs ? Math.round(medianResponseMs) : null,
      totalReps,
      calibrationGap: existing?.calibrationGap ?? null,
      firstStudiedAt,
      masteredAt,
      automatedAt,
      timeToMasterySeconds,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: nodeProgress.nodeId,
      set: {
        knowledgeStrength,
        automaticityIndex,
        accuracyRate: accuracy,
        medianResponseTimeMs: medianResponseMs ? Math.round(medianResponseMs) : null,
        totalReps,
        firstStudiedAt,
        masteredAt,
        automatedAt,
        timeToMasterySeconds,
        updatedAt: now,
      },
    });

  if (statusAfter !== statusBefore) {
    await db.update(knowledgeNodes).set({ status: statusAfter, updatedAt: now }).where(eq(knowledgeNodes.id, nodeId));
  }

  return {
    nodeId,
    statusBefore,
    statusAfter,
    knowledgeStrength,
    automaticityIndex,
    nextReviewAt: card.due.toISOString(),
  };
}

async function hasPreAssessmentAnswer(userId: string, nodeId: string): Promise<boolean> {
  const preIds = await db
    .select({ id: assessments.id })
    .from(assessments)
    .where(and(eq(assessments.nodeId, nodeId), eq(assessments.isPreAssessment, true)));
  if (preIds.length === 0) return false;
  const answered = await db.query.userResponses.findFirst({
    where: and(
      eq(userResponses.userId, userId),
      inArray(
        userResponses.assessmentId,
        preIds.map((p) => p.id),
      ),
    ),
  });
  return Boolean(answered);
}

async function personalResponseBaseline(userId: string): Promise<number | null> {
  const rows = await db
    .select({ responseTimeMs: userResponses.responseTimeMs })
    .from(userResponses)
    .where(and(eq(userResponses.userId, userId), eq(userResponses.isCorrect, true)))
    .orderBy(desc(userResponses.createdAt))
    .limit(200);
  return median(rows.map((r) => r.responseTimeMs));
}

/**
 * Пробел, вскрытый защитой проекта (`revealedGapNodeIds`), после того как
 * узел уже достиг mastered/automated. `resolvedSince` — момент, когда
 * мастерство было присвоено; гэп, вскрытый ДО этого момента, уже учтён
 * тем самым присвоением и не должен откатывать статус повторно.
 */
async function hasUnresolvedDefenseGap(nodeId: string, resolvedSince: Date | null): Promise<boolean> {
  if (!resolvedSince) return false;

  const rows = await db
    .select({ id: projectSubmissions.id })
    .from(projectSubmissions)
    .where(
      and(
        sql`${projectSubmissions.revealedGapNodeIds} @> ${JSON.stringify([nodeId])}::jsonb`,
        gt(projectSubmissions.reviewedAt, resolvedSince),
      ),
    )
    .limit(1);

  return rows.length > 0;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export type { NodeStatus } from '../../services/practice/transitions';
