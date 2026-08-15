import { NextResponse } from 'next/server';

import { UnauthorizedError, requireUserIdOrThrow } from '@/lib/auth/require-user';
import { recomputeNodeProgress } from '@/lib/db/queries/progress';
import { assertCardOwnership } from '@/lib/db/queries/review';
import { applyReview, previewReview } from '@/lib/services/fsrs/engine';
import { gradeCardSchema } from '@/lib/validation/practice';

/**
 * Ручная оценка карточки — контракт `docs/API.md` §4. Автоматически оценка
 * выводится из результатов сессии практики (`sessions/:id/complete`); этот
 * маршрут — явное переопределение (например, из отдельного экрана очереди
 * повторений без прогона полного набора заданий).
 */

export async function POST(
  request: Request,
  { params }: { params: Promise<{ cardId: string }> },
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

  const { cardId } = await params;
  const parsed = gradeCardSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: 'VALIDATION_FAILED', message: 'Некорректный запрос' } },
      { status: 400 },
    );
  }

  const card = await assertCardOwnership(userId, cardId);
  if (!card) {
    return NextResponse.json({ error: { code: 'NOT_FOUND', message: 'Карточка не найдена.' } }, { status: 404 });
  }

  const now = parsed.data.reviewedAt ? new Date(parsed.data.reviewedAt) : new Date();
  const preview = await previewReview(userId, card);
  const { card: updated } = await applyReview({
    userId,
    card,
    rating: parsed.data.rating,
    now,
    sessionId: parsed.data.sessionId ?? null,
    derivedFrom: 1,
  });

  const progress = await recomputeNodeProgress(userId, card.nodeId, now);

  return NextResponse.json({
    card: {
      due: updated.due.toISOString(),
      state: updated.state,
      stability: updated.stability,
      difficulty: updated.difficulty,
      scheduledDays: updated.scheduledDays,
    },
    preview: Object.fromEntries(
      Object.entries(preview).map(([rating, p]) => [
        rating,
        { due: p.due.toISOString(), scheduledDays: p.scheduledDays },
      ]),
    ),
    nodeStatus: progress.statusAfter,
  });
}
