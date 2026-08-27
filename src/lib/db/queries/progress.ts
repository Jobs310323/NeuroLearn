import { and, count, desc, eq, gt, inArray, sql } from 'drizzle-orm';

import { db } from '@/lib/db';
import {
  assessments,
  knowledgeNodes,
  nodeProgress,
  practiceSessions,
  projectSubmissions,
  reflections,
  reviewLogs,
  userResponses,
} from '@/lib/db/schema';
import { ensureCard } from '@/lib/services/fsrs/engine';
import { rowToCard } from '@/lib/services/fsrs/mapping';
import { fsrs, generatorParameters } from 'ts-fsrs';

import { responseTimeBaselineMs } from '../../services/practice/automaticity';
import { responseTimeVariability } from '../../services/practice/fatigue';
import { nextNodeStatus, type NodeStatus } from '../../services/practice/transitions';

import { calibrationGapForNode, totalPracticeMsForNode } from './learner';

const RESPONSE_WINDOW = 20;

/**
 * Порог коэффициента вариации для F11. Не откалиброван на реальных данных
 * (в проекте пока нет истории для этого) — начальная эвристика того же рода,
 * что `FAST_RATIO` в `error-classifier.ts`: ниже — темп ощутимо ровнее
 * типичного разброса, выше — типичная неравномерность внимания, а не сбой.
 */
const RESPONSE_TIME_CV_THRESHOLD = 0.4;

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
  // Порог — персональная медиана ПО УРОВНЮ БЛУМА (`automaticity.ts`), как и
  // определяет PRD: recall и analyze имеют разную естественную скорость даже
  // при полном владении, единая медиана по всем ответам смешивала их.
  const baselineSamples = await personalResponseTimeSamples(userId);
  const correct = recent.filter((r) => r.isCorrect);
  const correctAndFast = correct.filter((r) => {
    const baseline = responseTimeBaselineMs(baselineSamples, r.cognitiveLevel);
    const threshold = Math.min(r.targetResponseMs ?? Infinity, 1.3 * (baseline ?? Infinity));
    return Number.isFinite(threshold) ? r.responseTimeMs <= threshold : false;
  });
  const automaticityIndex = correct.length === 0 ? 0 : correctAndFast.length / correct.length;

  // F11: устойчивость темпа, а не только его средняя скорость (см.
  // комментарий у `TransitionFacts.responseTimeConsistent`). `null` —
  // наблюдений пока мало, и это НЕ приравнивается к устойчивости: тот же
  // принцип, что применяется к `interleavedAccuracy` ниже (отсутствие
  // доказательства — не доказательство).
  const responseTimeCv = responseTimeVariability(
    recent.map((r) => ({ responseTimeMs: r.responseTimeMs, isCorrect: r.isCorrect })),
  );
  const responseTimeConsistent = responseTimeCv !== null && responseTimeCv <= RESPONSE_TIME_CV_THRESHOLD;

  const distinctPracticeDays = new Set(recent.map((r) => calendarDay(r.createdAt))).size;

  // `userId` в условии обязателен, хотя пользователь пока один: правило
  // PRD §10 — владение проверяется в каждом запросе, а не подразумевается
  // из того, что чужих данных в базе «всё равно нет». Без него чужая
  // рефлексия по тому же узлу открывала бы переход в `mastered`.
  const hasPostModuleReflection = await db.query.reflections
    .findFirst({
      where: and(
        eq(reflections.userId, userId),
        eq(reflections.nodeId, nodeId),
        eq(reflections.type, 'post_module'),
      ),
    })
    .then((row) => Boolean(row));

  const longReviews = await db
    .select({ scheduledDays: reviewLogs.scheduledDays, rating: reviewLogs.rating })
    .from(reviewLogs)
    .where(eq(reviewLogs.cardId, card.id));
  const successfulLongReviews = longReviews.filter(
    (r) => r.scheduledDays >= 7 && r.rating !== 'again',
  ).length;

  // Точность именно в перемешанном режиме. Признака интерливинга у самого
  // ответа нет — он свойство сессии (`practice_sessions.interleaved`),
  // поэтому нужен join. Раньше здесь стоял запрос, дословно повторявший
  // выборку `recent` выше, без всякого фильтра: условие перехода
  // `mastered -> automated` («точность >= 0.9 в интерливинг-режиме», PRD §5)
  // проверяло обычную точность и пропускало узлы, ни разу не проверенные
  // вперемешку. Тот же расчёт правильным способом уже был в
  // `queries/analytics.ts` — здесь он приведён к нему.
  const interleavedRecent = await db
    .select({ isCorrect: userResponses.isCorrect })
    .from(userResponses)
    .innerJoin(practiceSessions, eq(practiceSessions.id, userResponses.sessionId))
    .where(
      and(
        eq(userResponses.userId, userId),
        eq(userResponses.nodeId, nodeId),
        eq(practiceSessions.interleaved, true),
      ),
    )
    .orderBy(desc(userResponses.createdAt))
    .limit(RESPONSE_WINDOW);
  // null, а не 0, когда перемешанной практики ещё не было: 0 читался бы как
  // «проверено и провалено», а на деле проверка просто не проводилась.
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
    responseTimeConsistent,
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

  // Разрыв «уверенность − точность» по узлу. Считался и раньше — но только
  // в ответе `POST /sessions/:id/complete`, и никуда не сохранялся: колонка
  // `calibration_gap` оставалась пустой навсегда, хотя PRD §3 п.5 обещает
  // её как триггер MetacognitiveCoach. Прежнее значение сохраняется, если
  // уверенность по узлу ни разу не собиралась.
  const calibrationGap =
    (await calibrationGapForNode(userId, nodeId, RESPONSE_WINDOW)) ?? existing?.calibrationGap ?? null;

  // Сумма длительностей завершённых сессий по узлу (PRD §5). Колонка есть с
  // самого начала, писателя не было.
  const totalPracticeMs = await totalPracticeMsForNode(userId, nodeId);

  const firstStudiedAt = existing?.firstStudiedAt ?? (hasAnyResponse ? now : null);
  const masteredAt =
    existing?.masteredAt ?? (statusAfter === 'mastered' && statusBefore !== 'mastered' ? now : null);
  const automatedAt =
    existing?.automatedAt ?? (statusAfter === 'automated' && statusBefore !== 'automated' ? now : null);
  // PRD §5: время до мастерства — сумма времени практики, а не разница дат.
  // По стенным часам сюда попадали недели, когда узел просто лежал в очереди
  // и ждал следующего повторения.
  const timeToMasterySeconds =
    existing?.timeToMasterySeconds ?? (automatedAt ? Math.round(totalPracticeMs / 1000) : null);

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
      totalPracticeMs,
      calibrationGap,
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
        totalPracticeMs,
        calibrationGap,
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

async function personalResponseTimeSamples(userId: string): Promise<{ responseTimeMs: number; cognitiveLevel: string }[]> {
  return db
    .select({ responseTimeMs: userResponses.responseTimeMs, cognitiveLevel: assessments.cognitiveLevel })
    .from(userResponses)
    .innerJoin(assessments, eq(assessments.id, userResponses.assessmentId))
    .where(and(eq(userResponses.userId, userId), eq(userResponses.isCorrect, true)))
    .orderBy(desc(userResponses.createdAt))
    .limit(200);
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
