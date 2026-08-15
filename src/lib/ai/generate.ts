import { NoObjectGeneratedError, streamObject } from 'ai';
import type { z } from 'zod';

import { finishGeneration, startGeneration } from './audit';
import { resolveModel } from './resilient-model';
import type { AgentKind } from './provider';

/**
 * Структурированная генерация с одной повторной попыткой.
 *
 * Ответ модели не попадает никуда, не пройдя Zod. При провале валидации
 * делается ровно один повтор с текстом ошибки в промпте: больше попыток
 * на бесплатных моделях лишь жгут лимиты, не повышая шансов.
 */
export async function generateValidated<T extends z.ZodType>(params: {
  agent: AgentKind;
  operation: string;
  userId: string | null;
  system: string;
  prompt: string;
  schema: T;
  targetTable?: string;
  targetId?: string;
  maxOutputTokens?: number;
  /**
   * Сколько времени осталось у вызывающего кода. Повтор запускается, только
   * если он успеет закончиться: иначе функцию убивает лимит платформы раньше,
   * чем `finishGeneration` запишет причину, и в аудите остаётся вечный
   * `pending`. Провал с записанной причиной полезнее провала без неё.
   */
  retryBudgetMs?: number;
}): Promise<{ data: z.infer<T>; generationId: string }> {
  // Резолвится один раз до цикла: обе попытки (основная + retry-на-ошибку-
  // схемы) должны идти на одну и ту же модель — иначе retry с текстом ошибки
  // прошлой попытки может уйти на модель, которая эту ошибку не совершала,
  // и подсказка её собьёт вместо того, чтобы помочь.
  const { model, modelId, tier } = await resolveModel(params.agent);
  if (tier === 'fallback') {
    console.warn(
      `${params.agent}/${params.operation}: основная модель в circuit breaker, использую резерв ${modelId}`,
    );
  }

  const generationId = await startGeneration({
    userId: params.userId,
    agent: params.agent,
    operation: params.operation,
    modelId,
    targetTable: params.targetTable,
    targetId: params.targetId,
  });

  const startedAt = Date.now();
  let lastError: string | undefined;

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      // Стримом, а не одним запросом: `generateObject` держит сокет без
      // единого байта, пока модель не сформирует весь JSON, и апстрим
      // отваливается по idle-timeout ещё до готовности ответа. Стрим
      // шлёт токены по мере генерации — простоя не возникает.
      const stream = streamObject({
        model,
        schema: params.schema,
        system: params.system,
        prompt:
          attempt === 0
            ? params.prompt
            : `${params.prompt}\n\nПредыдущая попытка не прошла проверку структуры. Исправь ровно это:\n${lastError}`,
        maxOutputTokens: params.maxOutputTokens ?? 8000,
        temperature: 0.4,
      });

      const object = await stream.object;
      const usage = await stream.usage;

      await finishGeneration(generationId, {
        status: 'succeeded',
        retryCount: attempt,
        tokensIn: usage?.inputTokens,
        tokensOut: usage?.outputTokens,
        latencyMs: Date.now() - startedAt,
      });

      return { data: object as z.infer<T>, generationId };
    } catch (error) {
      const schemaProblem = NoObjectGeneratedError.isInstance(error);
      lastError = describeFailure(error);

      const elapsed = Date.now() - startedAt;
      const outOfTime =
        params.retryBudgetMs !== undefined && elapsed * 2 > params.retryBudgetMs;

      if (outOfTime) {
        lastError = `${lastError}\nПовтор не запускался: на него не осталось времени (${elapsed} мс уже потрачено).`;
      }

      if (!schemaProblem || outOfTime || attempt === 1) {
        await finishGeneration(generationId, {
          status: schemaProblem ? 'schema_failed' : 'provider_failed',
          validationError: lastError,
          retryCount: attempt,
          latencyMs: Date.now() - startedAt,
        });
        throw error;
      }
    }
  }

  throw new Error('unreachable');
}

/**
 * Сообщение AI SDK при провале схемы («response did not match schema») не
 * говорит, какое поле сломалось. Разбор нужен и для повторной попытки —
 * модель получает этот текст в промпте, — и для разбора регрессий по
 * `ai_generations.validation_error`.
 */
function describeFailure(error: unknown): string {
  if (!NoObjectGeneratedError.isInstance(error)) {
    return error instanceof Error ? error.message : String(error);
  }

  const parts = [error.message];

  const cause = error.cause;
  if (cause instanceof Error && cause.message !== error.message) {
    parts.push(cause.message.slice(0, 2000));
  }

  if (error.text) parts.push(`Ответ модели (начало): ${error.text.slice(0, 800)}`);
  if (error.finishReason) parts.push(`finishReason: ${error.finishReason}`);

  return parts.join('\n');
}
