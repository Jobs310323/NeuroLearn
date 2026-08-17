import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

/**
 * Проверка исчерпанного бюджета перед вызовом модели.
 *
 * Смысл именно в порядке: отказ должен случиться ДО `startGeneration`, иначе
 * в `ai_generations` появится строка `provider_failed`, неотличимая от
 * настоящего падения апстрима, и circuit breaker закроет модель, которая
 * не отказывала.
 *
 * `@/lib/db` замокан целиком: цепочка импортов `resilient-model` требует
 * `DATABASE_URL` уже на загрузке модуля.
 */

vi.mock('@/lib/db', () => ({ db: {} }));

const startGeneration = vi.fn(async () => 'generation-id');
const finishGeneration = vi.fn(async () => undefined);
vi.mock('./audit', () => ({ startGeneration, finishGeneration }));

const { GenerationBudgetError, generateValidated } = await import('./generate');

function call(retryBudgetMs: number | undefined) {
  return generateValidated({
    agent: 'content_generator',
    operation: 'generate_module_assessments',
    userId: null,
    system: 'system',
    prompt: 'prompt',
    schema: z.object({ ok: z.boolean() }),
    retryBudgetMs,
  });
}

describe('generateValidated: бюджет вызова', () => {
  it('отказывает, когда времени меньше минимального окна запроса', async () => {
    await expect(call(20_000)).rejects.toBeInstanceOf(GenerationBudgetError);
  });

  it('не заводит запись в аудите при исчерпанном бюджете', async () => {
    startGeneration.mockClear();
    await expect(call(0)).rejects.toBeInstanceOf(GenerationBudgetError);
    expect(startGeneration).not.toHaveBeenCalled();
  });

  it('отрицательный остаток (вызывающий код уже просрочил бюджет) — тот же отказ', async () => {
    await expect(call(-5_000)).rejects.toBeInstanceOf(GenerationBudgetError);
  });

  it('без указанного бюджета проверка не срабатывает', async () => {
    // Дальше начинается сеть, поэтому проверяется только то, что отказ
    // не бюджетный: до `resolveModel` вызов дошёл.
    await expect(call(undefined)).rejects.not.toBeInstanceOf(GenerationBudgetError);
  });
});
