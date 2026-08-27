import { and, eq } from 'drizzle-orm';
import { NextResponse, after } from 'next/server';

import { classifySessionErrors } from '@/lib/ai/agents/error-classifier';
import { analyzeProgress } from '@/lib/ai/agents/progress-analyzer';
import { UnauthorizedError, requireUserIdOrThrow } from '@/lib/auth/require-user';
import { db } from '@/lib/db';
import { fsrsCards, practiceSessions, reviewLogs, userResponses } from '@/lib/db/schema';
import { recomputeCognitiveProfile } from '@/lib/db/queries/learner';
import { recomputeNodeProgress } from '@/lib/db/queries/progress';
import { logError } from '@/lib/monitoring/logger';
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
  const cognitiveLevelById = new Map(answered.map((a) => [a.id, a.cognitiveLevel]));

  const correctCount = responses.filter((r) => r.isCorrect).length;
  const score = responses.length === 0 ? 0 : correctCount / responses.length;
  const durationMs = now.getTime() - session.startedAt.getTime();

  const results = responses.map((r) => ({
    assessmentId: r.assessmentId,
    nodeId: r.nodeId,
    cognitiveLevel: cognitiveLevelById.get(r.assessmentId) ?? null,
    isCorrect: r.isCorrect,
    partialScore: r.partialScore,
    explanation: explanationById.get(r.assessmentId) ?? null,
    confidenceLevel: r.confidenceLevel,
    miscalibrated: r.confidenceLevel != null && r.confidenceLevel >= 4 && !r.isCorrect,
  }));

  // FSRS-оценка и пересчёт прогресса — по каждому затронутому узлу отдельно
  // (единица планирования FSRS — узел, PRD §10).
  //
  // Порядок важен. Раньше сессия помечалась завершённой ДО этого цикла, и
  // падение на середине (обрыв до Neon — обычное дело для neon-http, где нет
  // интерактивной транзакции) оставляло сессию закрытой, а часть узлов — без
  // оценки повторения. Повторный запрос упирался в 409 «уже завершена», и
  // повторения по этим узлам пропадали навсегда.
  //
  // Теперь `completedAt` ставится последним, а сам обработчик сделан
  // повторяемым: узлы, по которым оценка уже записана в этой сессии,
  // пропускаются. Признак берётся из `review_logs.session_id` — отдельного
  // поля прогресса заводить не нужно, журнал повторений и есть факт
  // применения оценки.
  const nodeIds = [...new Set(responses.map((r) => r.nodeId))];
  const reviewedNodeIds = new Set(
    (
      await db
        .select({ nodeId: fsrsCards.nodeId })
        .from(reviewLogs)
        .innerJoin(fsrsCards, eq(fsrsCards.id, reviewLogs.cardId))
        .where(eq(reviewLogs.sessionId, sessionId))
    ).map((row) => row.nodeId),
  );
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

    if (!reviewedNodeIds.has(nodeId)) {
      const rating = deriveRatingFromSession({ accuracy, meanResponseMs, targetResponseMs });
      const card = await ensureCard(userId, nodeId);
      await applyReview({ userId, card, rating, now, sessionId, derivedFrom: 0 });
    }

    // Пересчёт запускается в любом случае: он читает состояние целиком и
    // повторный вызов даёт тот же результат.
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

  // Последним шагом: до этой строки повторный запрос — законная докатка,
  // после неё сессия закрыта и второй раз не выполняется.
  await db
    .update(practiceSessions)
    .set({ completedAt: now, score, correctCount, durationMs })
    .where(eq(practiceSessions.id, sessionId));

  // Обновление модели ученика — в фоне, после ответа. Отчёт о сессии от него
  // не зависит, а держать человека на экране ожидания ради вызова модели
  // незачем.
  //
  // Две разные вещи и разной ценой. Портрет считается арифметикой и не
  // может провалиться по вине апстрима — он идёт всегда. Разбор
  // `analyzeProgress` требует вызова LLM, поэтому у него есть собственный
  // порог (`MIN_RESPONSES = 5`) и он сам решает пропустить работу.
  //
  // Оба — `catch` с логом: провал фонового шага не должен превращаться в
  // необработанный отказ промиса, сессия к этому моменту уже закрыта.
  after(async () => {
    await recomputeCognitiveProfile(userId).catch((error: unknown) =>
      logError(error, 'session-complete:cognitive-profile', { sessionId }),
    );

    // Разбор ошибок идёт до общего анализа прогресса: он опирается на те же
    // ответы, но отвечает на более узкий вопрос («чем именно ошибся»), и его
    // результат должен быть в базе к моменту, когда ProgressAnalyzer
    // собирает срез для доски агентов.
    await classifySessionErrors({ userId, sessionId }).catch((error: unknown) =>
      logError(error, 'session-complete:classify-errors', { sessionId }),
    );

    if (session.pathId) {
      await analyzeProgress({ userId, scope: { scope: 'path', pathId: session.pathId } }).catch(
        (error: unknown) => logError(error, 'session-complete:analyze-progress', { sessionId }),
      );
    }
  });

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
