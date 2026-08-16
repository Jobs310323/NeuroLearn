import { NextResponse } from 'next/server';
import { z } from 'zod';

import { ContentGenerationError, generateTreeForPath } from '@/lib/ai/agents/content-generator';
import { AiNotConfiguredError } from '@/lib/ai/provider';
import { UnauthorizedError, requireUserIdOrThrow } from '@/lib/auth/require-user';
import { checkRateLimit } from '@/lib/security/rate-limit';

/**
 * Генерация дерева знаний. Контракт — docs/API.md §2.
 *
 * Упрощение относительно исходного контракта: ответ — один JSON после
 * завершения, а не поток SSE по узлам. `generateValidated` вызывает модель
 * одним `generateObject`, промежуточных узлов не существует, стримить
 * нечего; для личного использования с генерацией в десятки секунд простой
 * спиннер эквивалентен SSE и не требует его сложности.
 */

/** Бесплатная модель отдавала дерево за 48–202 с: дефолтных 60 не хватает. */
export const maxDuration = 300;

const bodySchema = z.object({
  pathId: z.string().uuid(),
  replaceExisting: z.boolean().optional(),
});

const ERROR_STATUS: Record<string, number> = {
  NOT_FOUND: 404,
  TREE_EXISTS: 409,
  GRAPH_CYCLE: 422,
};

/** Десятки секунд работы модели на вызов — то же окно, что у генерации модуля. */
const GENERATION_RATE_LIMIT = { limit: 5, window: '1 h' } as const;

export async function POST(request: Request): Promise<Response> {
  let userId: string;
  try {
    userId = await requireUserIdOrThrow();
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return NextResponse.json({ error: { code: 'UNAUTHORIZED', message: error.message } }, { status: 401 });
    }
    throw error;
  }

  const rateLimit = await checkRateLimit(`generate-tree:${userId}`, GENERATION_RATE_LIMIT);
  if (!rateLimit.allowed) {
    return NextResponse.json(
      { error: { code: 'RATE_LIMITED', message: 'Слишком много генераций подряд, подождите.' } },
      { status: 429, headers: { 'Retry-After': String(rateLimit.retryAfterSeconds) } },
    );
  }

  const parsed = bodySchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: 'VALIDATION_FAILED', message: 'Некорректный запрос', details: parsed.error.flatten() } },
      { status: 400 },
    );
  }

  try {
    const result = await generateTreeForPath({
      userId,
      pathId: parsed.data.pathId,
      replaceExisting: parsed.data.replaceExisting,
    });
    return NextResponse.json({ pathId: parsed.data.pathId, ...result });
  } catch (error) {
    if (error instanceof ContentGenerationError) {
      return NextResponse.json(
        { error: { code: error.code, message: error.message } },
        { status: ERROR_STATUS[error.code] ?? 500 },
      );
    }
    if (error instanceof AiNotConfiguredError) {
      return NextResponse.json({ error: { code: error.code, message: error.message } }, { status: 503 });
    }
    throw error;
  }
}
