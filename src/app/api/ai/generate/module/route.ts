import { NextResponse, after } from 'next/server';
import { z } from 'zod';

import {
  ContentGenerationError,
  assertModuleGeneratable,
  generateModuleForNode,
} from '@/lib/ai/agents/content-generator';
import { moduleGenerationStatus } from '@/lib/ai/status';
import { reconcileStaleGenerations } from '@/lib/ai/reconcile';
import { UnauthorizedError, requireUserIdOrThrow } from '@/lib/auth/require-user';

/**
 * Генерация модуля из 10 блоков + банка заданий. Контракт — docs/API.md §2.
 *
 * Отступление от исходного контракта: POST не ждёт результата. Генерация идёт
 * двумя вызовами бесплатной модели и занимает минуты; держать HTTP-соединение
 * открытым всё это время нельзя — обрыв на стороне клиента убивал вызов на
 * середине. Поэтому POST проверяет права и возвращает 202, работа
 * продолжается в `after()`, а прогресс читается через GET этого же маршрута.
 */

/** Верхняя граница фоновой работы; согласовано с `GENERATION_BUDGET_MS`. */
export const maxDuration = 300;

const bodySchema = z.object({
  nodeId: z.string().uuid(),
  regenerate: z.boolean().optional(),
});

const ERROR_STATUS: Record<string, number> = {
  NOT_FOUND: 404,
  CONTENT_EXISTS: 409,
};

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

  const parsed = bodySchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: 'VALIDATION_FAILED', message: 'Некорректный запрос', details: parsed.error.flatten() } },
      { status: 400 },
    );
  }

  // Закрываем зависшие строки прошлых прерванных вызовов: иначе аудит
  // навсегда показывает генерации, которые никто не завершал.
  await reconcileStaleGenerations().catch(() => undefined);

  const { nodeId, regenerate } = parsed.data;

  try {
    await assertModuleGeneratable({ userId, nodeId, regenerate });
  } catch (error) {
    if (error instanceof ContentGenerationError) {
      return NextResponse.json(
        { error: { code: error.code, message: error.message } },
        { status: ERROR_STATUS[error.code] ?? 500 },
      );
    }
    throw error;
  }

  after(async () => {
    // Провал уже записан в `ai_generations` внутри generateValidated —
    // клиент увидит его через GET. Здесь только гасим unhandled rejection.
    await generateModuleForNode({ userId, nodeId, regenerate }).catch(() => undefined);
  });

  return NextResponse.json({ nodeId, status: 'started' }, { status: 202 });
}

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

  const nodeId = new URL(request.url).searchParams.get('nodeId');
  if (!nodeId || !z.string().uuid().safeParse(nodeId).success) {
    return NextResponse.json(
      { error: { code: 'VALIDATION_FAILED', message: 'Нужен параметр nodeId' } },
      { status: 400 },
    );
  }

  try {
    return NextResponse.json(await moduleGenerationStatus({ userId, nodeId }));
  } catch (error) {
    if (error instanceof ContentGenerationError) {
      return NextResponse.json(
        { error: { code: error.code, message: error.message } },
        { status: ERROR_STATUS[error.code] ?? 500 },
      );
    }
    throw error;
  }
}
