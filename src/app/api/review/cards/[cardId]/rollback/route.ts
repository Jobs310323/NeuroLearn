import { NextResponse } from 'next/server';

import { UnauthorizedError, requireUserIdOrThrow } from '@/lib/auth/require-user';
import { rollbackLastReview } from '@/lib/services/fsrs/engine';

/** Отмена последней оценки карточки — контракт `docs/API.md` §4. */

const ERROR_STATUS: Record<string, number> = {
  NOT_FOUND: 404,
  NO_HISTORY: 404,
  WINDOW_EXPIRED: 409,
};

const ERROR_MESSAGE: Record<string, string> = {
  NOT_FOUND: 'Карточка не найдена.',
  NO_HISTORY: 'У карточки нет истории повторений.',
  WINDOW_EXPIRED: 'Окно отмены (5 минут) истекло.',
};

export async function POST(
  _request: Request,
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
  const result = await rollbackLastReview(userId, cardId);

  if ('error' in result) {
    return NextResponse.json(
      { error: { code: result.error, message: ERROR_MESSAGE[result.error] } },
      { status: ERROR_STATUS[result.error] ?? 500 },
    );
  }

  return NextResponse.json({
    card: {
      due: result.card.due.toISOString(),
      state: result.card.state,
      stability: result.card.stability,
      difficulty: result.card.difficulty,
      scheduledDays: result.card.scheduledDays,
    },
  });
}
