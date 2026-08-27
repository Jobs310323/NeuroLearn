import { NextResponse } from 'next/server';

import { db } from '@/lib/db';
import { loadHintBootstrap } from '@/lib/db/queries/hints';
import { users } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { UnauthorizedError, requireUserIdOrThrow } from '@/lib/auth/require-user';
import { DEFAULT_COGNITIVE_PROFILE } from '@/lib/db/schema/types';
import { decidePolicy } from '@/lib/services/practice/policy';
import { encodeDraft } from '@/lib/services/practice/draft';
import { buildPracticeQueue } from '@/lib/services/practice/selector';
import { practiceNextQuerySchema } from '@/lib/validation/practice';

/** Подбор набора заданий — контракт `docs/API.md` §3. */

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
  const parsed = practiceNextQuerySchema.safeParse(Object.fromEntries(searchParams));
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: 'VALIDATION_FAILED', message: 'Некорректный запрос', details: parsed.error.flatten() } },
      { status: 400 },
    );
  }

  const { nodeId, mix, mode } = parsed.data;

  const user = await db.query.users.findFirst({ where: eq(users.id, userId), columns: { cognitiveProfile: true } });
  const profile = user?.cognitiveProfile ?? DEFAULT_COGNITIVE_PROFILE;

  const policy = decidePolicy({
    profile,
    mix,
    explicitInterleaveRatio: parsed.data.interleaveRatio,
    explicitLimit: parsed.data.limit,
  });

  const queue = await buildPracticeQueue({
    userId,
    nodeId,
    mix,
    limit: policy.limit,
    mode,
    interleaveRatio: policy.interleaveRatio,
  });
  if (!queue) {
    return NextResponse.json({ error: { code: 'NOT_FOUND', message: 'Узел не найден.' } }, { status: 404 });
  }

  if (queue.items.length === 0) {
    return NextResponse.json(
      { error: { code: 'EMPTY_QUEUE', message: 'Нет доступных заданий: материал ещё не готов, либо всё недавно отвечено верно.' } },
      { status: 404 },
    );
  }

  const sessionDraftId = encodeDraft({
    nodeId,
    mode,
    mix,
    interleaveRatio: queue.interleaveRatio,
    sourceNodeIds: queue.sourceNodeIds,
    assessmentIds: queue.items.map((item) => item.assessmentId),
  });

  // Контекст подсказок собирается здесь же и отдаётся целиком: правила —
  // чистые функции, им нужен готовый вход. `decidePolicy` выше это НЕ читает
  // и читать не должен — подсказки не влияют на подбор (инвариант проверен
  // тестом `lib/practice/hints/no-ai-imports.test.ts`).
  const hints = await loadHintBootstrap(userId, queue.sourceNodeIds);

  return NextResponse.json({
    sessionDraftId,
    items: queue.items,
    hints,
    meta: {
      sourceNodeIds: queue.sourceNodeIds,
      interleaveRatio: queue.interleaveRatio,
      citationKey: mix ? 'interleaving' : null,
    },
  });
}
