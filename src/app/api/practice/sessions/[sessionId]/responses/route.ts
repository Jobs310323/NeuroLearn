import { and, eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';

import { UnauthorizedError, requireUserIdOrThrow } from '@/lib/auth/require-user';
import { db } from '@/lib/db';
import { assessments, practiceSessions, userResponses } from '@/lib/db/schema';
import { gradeResponse } from '@/lib/services/practice/grader';
import { submitResponseSchema } from '@/lib/validation/practice';

/** Приём ответа на задание — контракт `docs/API.md` §3. Проверка — только на сервере. */

export async function POST(
  request: Request,
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
  const parsed = submitResponseSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: 'VALIDATION_FAILED', message: 'Некорректный запрос', details: parsed.error.flatten() } },
      { status: 400 },
    );
  }

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
  if (!session.itemOrder.includes(parsed.data.assessmentId)) {
    return NextResponse.json(
      { error: { code: 'NOT_IN_SESSION', message: 'Задание не входит в эту сессию.' } },
      { status: 400 },
    );
  }

  const assessment = await db.query.assessments.findFirst({
    where: eq(assessments.id, parsed.data.assessmentId),
  });
  if (!assessment) {
    return NextResponse.json({ error: { code: 'NOT_FOUND', message: 'Задание не найдено.' } }, { status: 404 });
  }

  // `userId` в условии — то же правило PRD §10, что и везде: владение
  // проверяется явно. Сессия выше уже отфильтрована по пользователю, так что
  // сейчас это дублирование, но правило не должно держаться на цепочке
  // рассуждений о другом запросе.
  const alreadyAnswered = await db.query.userResponses.findFirst({
    where: and(
      eq(userResponses.userId, userId),
      eq(userResponses.sessionId, sessionId),
      eq(userResponses.assessmentId, parsed.data.assessmentId),
    ),
  });
  if (alreadyAnswered) {
    return NextResponse.json(
      { error: { code: 'ALREADY_ANSWERED', message: 'На это задание уже есть ответ в этой сессии.' } },
      { status: 409 },
    );
  }

  const { isCorrect, partialScore } = gradeResponse(assessment, parsed.data.response);
  const isInstant = assessment.feedbackMode === 'instant';
  const now = new Date();

  await db.insert(userResponses).values({
    userId,
    sessionId,
    assessmentId: assessment.id,
    nodeId: assessment.nodeId,
    response: parsed.data.response,
    isCorrect,
    partialScore,
    responseTimeMs: parsed.data.responseTimeMs,
    confidenceLevel: parsed.data.confidenceLevel ?? null,
    confidenceLatencyMs: parsed.data.confidenceLatencyMs ?? null,
    jokLevel: parsed.data.jokLevel ?? null,
    hintsUsed: parsed.data.hintsUsed ?? 0,
    retrievalAttempted: parsed.data.retrievalAttempted ?? true,
    feedbackShownAt: isInstant ? now : null,
  });

  if (isInstant) {
    return NextResponse.json({
      revealed: true,
      isCorrect,
      partialScore,
      explanation: assessment.explanation,
      socraticHints: isCorrect ? [] : assessment.socraticHints,
      citationKey: 'testing_effect',
    });
  }

  return NextResponse.json({
    revealed: false,
    recorded: true,
    citationKey: 'delayed_feedback',
    hint: 'Результат появится после завершения набора.',
  });
}
