import { and, eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';

import { UnauthorizedError, requireUserIdOrThrow } from '@/lib/auth/require-user';
import { db } from '@/lib/db';
import { practiceSessions, userResponses } from '@/lib/db/schema';
import { recomputeNodeProgress } from '@/lib/db/queries/progress';
import { applyReview, deriveRatingFromSession, ensureCard } from '@/lib/services/fsrs/engine';

/**
 * Раскрытие отложенной обратной связи и пересчёт — контракт `docs/API.md` §3.
 * Побочные эффекты в одном месте: `feedback_shown_at`, `node_progress`,
 * переходы статусов, оценка FSRS-карточки, кандидаты в рефлексию.
 */

const GENERIC_REFLECTION_PROMPTS = [
  'Что в этом узле оказалось сложнее, чем ты ожидал(а)?',
  'Какое правило или шаг ты бы объяснил(а) новичку своими словами?',
  'Где ты чаще всего ошибался(лась) и почему, как думаешь?',
];

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ sessionId: string }> },
): Promise<Response> {
  let userId: string;
  try {
    userId = await requireUserIdOrThrow();
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return NextResponse.json({ error: { code: 'UNAUTHORIZED', message: error.message } }, { status: 401 });
    }
    throw error;
  }

  const { sessionId } = await params;
  const session = await db.query.practiceSessions.findFirst({
    where: and(eq(practiceSessions.id, sessionId), eq(practiceSessions.userId, userId)),
  });
  if (!session) {
    return NextResponse.json({ error: { code: 'NOT_FOUND', message: 'Сессия не найдена.' } }, { status: 404 });
  }
  if (session.completedAt) {
    return NextResponse.json(
      { error: { code: 'SESSION_COMPLETED', message: 'Сессия уже завершена.' } },
      { status: 409 },
    );
  }

  const now = new Date();
  const responses = await db
    .select()
    .from(userResponses)
    .where(eq(userResponses.sessionId, sessionId));

  // Раскрываем отложенную обратную связь всем ответам сессии, у которых её ещё не было.
  const toReveal = responses.filter((r) => !r.feedbackShownAt);
  if (toReveal.length > 0) {
    await db.batch(
      toReveal.map((r) =>
        db.update(userResponses).set({ feedbackShownAt: now }).where(eq(userResponses.id, r.id)),
      ) as never,
    );
  }

  const answered = await db.query.assessments.findMany({
    where: (fields, { inArray }) => inArray(fields.id, responses.map((r) => r.assessmentId)),
  });
  const explanationById = new Map(answered.map((a) => [a.id, a.explanation]));
  const targetResponseMsById = new Map(answered.map((a) => [a.id, a.targetResponseMs]));

  const correctCount = responses.filter((r) => r.isCorrect).length;
  const score = responses.length === 0 ? 0 : correctCount / responses.length;
  const durationMs = now.getTime() - session.startedAt.getTime();

  await db
    .update(practiceSessions)
    .set({ completedAt: now, score, correctCount, durationMs })
    .where(eq(practiceSessions.id, sessionId));

  const results = responses.map((r) => ({
    assessmentId: r.assessmentId,
    isCorrect: r.isCorrect,
    partialScore: r.partialScore,
    explanation: explanationById.get(r.assessmentId) ?? null,
    confidenceLevel: r.confidenceLevel,
    miscalibrated: r.confidenceLevel != null && r.confidenceLevel >= 4 && !r.isCorrect,
  }));

  // FSRS-оценка и пересчёт прогресса — по каждому затронутому узлу отдельно
  // (единица планирования FSRS — узел, PRD §10).
  const nodeIds = [...new Set(responses.map((r) => r.nodeId))];
  const nodeUpdates = [];
  const reflectionCandidates: { nodeId: string; prompts: string[] }[] = [];

  for (const nodeId of nodeIds) {
    const nodeResponses = responses.filter((r) => r.nodeId === nodeId);
    const accuracy = nodeResponses.filter((r) => r.isCorrect).length / nodeResponses.length;
    const meanResponseMs =
      nodeResponses.reduce((sum, r) => sum + r.responseTimeMs, 0) / nodeResponses.length;
    const targetTimes = nodeResponses
      .map((r) => targetResponseMsById.get(r.assessmentId))
      .filter((t): t is number => t != null);
    const targetResponseMs =
      targetTimes.length === 0 ? null : targetTimes.reduce((a, b) => a + b, 0) / targetTimes.length;

    const rating = deriveRatingFromSession({ accuracy, meanResponseMs, targetResponseMs });
    const card = await ensureCard(userId, nodeId);
    await applyReview({ userId, card, rating, now, sessionId, derivedFrom: 0 });

    const update = await recomputeNodeProgress(userId, nodeId, now);
    nodeUpdates.push(update);

    const readyForMasteryExceptReflection =
      update.statusBefore !== 'mastered' &&
      update.statusBefore !== 'automated' &&
      update.knowledgeStrength >= 80 &&
      update.statusAfter === update.statusBefore;
    if (readyForMasteryExceptReflection) {
      reflectionCandidates.push({ nodeId, prompts: GENERIC_REFLECTION_PROMPTS });
    }
  }

  const withConfidence = responses.filter((r) => r.confidenceLevel != null);
  const calibrationSummary =
    withConfidence.length === 0
      ? null
      : (() => {
          const meanConfidence =
            withConfidence.reduce((sum, r) => sum + ((r.confidenceLevel as number) - 1) / 4, 0) /
            withConfidence.length;
          const accuracy = withConfidence.filter((r) => r.isCorrect).length / withConfidence.length;
          return { meanConfidence, accuracy, gap: meanConfidence - accuracy };
        })();

  return NextResponse.json({
    score,
    durationMs,
    results,
    nodeUpdates: nodeUpdates.map((u) => ({
      nodeId: u.nodeId,
      statusBefore: u.statusBefore,
      statusAfter: u.statusAfter,
      knowledgeStrength: u.knowledgeStrength,
      automaticityIndex: u.automaticityIndex,
      nextReviewAt: u.nextReviewAt,
    })),
    reflectionRequired: reflectionCandidates[0] ?? null,
    calibrationSummary,
  });
}
