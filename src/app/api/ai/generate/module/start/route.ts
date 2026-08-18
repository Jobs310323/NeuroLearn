import { NextResponse, after } from 'next/server';
import { z } from 'zod';

import {
  ContentGenerationError,
  assertModuleGeneratable,
  generateModuleStep,
  moduleProgress,
} from '@/lib/ai/agents/content-generator';
import { reconcileStaleGenerations } from '@/lib/ai/reconcile';
import { UnauthorizedError, requireUserIdOrThrow } from '@/lib/auth/require-user';
import { logError } from '@/lib/monitoring/logger';
import { checkRateLimit } from '@/lib/security/rate-limit';

/**
 * Запуск ОДНОГО шага генерации модуля. Контракт — docs/API.md §2.
 *
 * Шагов три (блоки A, блоки B, задания), и каждый запускается отдельным
 * запросом. Причина не в красоте: все три вызова модели в одном запросе
 * упирались в платформенный лимит времени, а поднять его выше 300 секунд
 * нельзя. Теперь в лимит должен уложиться один вызов, а не три подряд.
 *
 * Ответ не ждёт результата: работа идёт в `after()`, а состояние читается
 * через GET /api/ai/generate/module/status. Какой шаг выполнять — решает не
 * клиент, а сервер по тому, что уже лежит в базе: повторный запуск после
 * обрыва доделывает недостающее, а не начинает заново.
 */

/** Верхняя граница фоновой работы одного шага. */
export const maxDuration = 300;

const bodySchema = z.object({
  nodeId: z.string().uuid(),
  regenerate: z.boolean().optional(),
});

const ERROR_STATUS: Record<string, number> = {
  NOT_FOUND: 404,
  CONTENT_EXISTS: 409,
};

/**
 * Верхняя граница расхода на модели: пять модулей в час, то есть пятнадцать
 * шагов. Считать шаги, а не модули, приходится потому, что лимит живёт на
 * уровне HTTP-запроса и о том, что три запроса — это один модуль, не знает.
 */
const GENERATION_RATE_LIMIT = { limit: 15, window: '1 h' } as const;

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

  const rateLimit = await checkRateLimit(`generate-module:${userId}`, GENERATION_RATE_LIMIT);
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

  // Закрываем зависшие строки прошлых прерванных вызовов: иначе аудит
  // навсегда показывает генерации, которые никто не завершал.
  await reconcileStaleGenerations().catch((error: unknown) =>
    logError(error, 'generate-module:reconcile'),
  );

  const { nodeId, regenerate } = parsed.data;

  // Проверки владения и «материал уже есть» обязаны отработать до ответа:
  // после ответа сообщить «узел не найден» уже некому.
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

  const progress = await moduleProgress(nodeId);
  if (!progress.nextStep) {
    return NextResponse.json({ nodeId, step: null, status: 'complete' });
  }

  after(async () => {
    // Провал самого вызова модели уже записан в `ai_generations` внутри
    // generateValidated — клиент увидит его через status. Сюда прилетает то,
    // чего в аудите нет (падение записи в БД, обрыв рантайма).
    await generateModuleStep({ userId, nodeId, regenerate }).catch((error: unknown) =>
      logError(error, 'generate-module:background', { nodeId, userId, step: progress.nextStep }),
    );
  });

  return NextResponse.json({ nodeId, step: progress.nextStep, status: 'started' }, { status: 202 });
}
