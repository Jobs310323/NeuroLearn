import { NextResponse } from 'next/server';

import { UnauthorizedError, requireUserIdOrThrow } from '@/lib/auth/require-user';
import { getReviewQueue } from '@/lib/db/queries/review';
import { reviewQueueQuerySchema } from '@/lib/validation/practice';

/** Очередь повторений — контракт `docs/API.md` §4. */

export async function GET(request: Request): Promise<Response> {
  let userId: string;
  try {
    userId = await requireUserIdOrThrow();
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return NextResponse.json({ error: { code: 'UNAUTHORIZED', message: error.message } }, { status: 401 });
    }
    throw error;
  }

  const { searchParams } = new URL(request.url);
  const parsed = reviewQueueQuerySchema.safeParse(Object.fromEntries(searchParams));
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: 'VALIDATION_FAILED', message: 'Некорректный запрос' } },
      { status: 400 },
    );
  }

  const queue = await getReviewQueue(userId, parsed.data);
  return NextResponse.json(queue);
}
