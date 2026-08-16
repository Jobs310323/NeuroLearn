/**
 * Решение circuit breaker'а, отделённое от чтения аудита (`resilient-model.ts`).
 * Отдельный модуль, а не экспорт оттуда: `resilient-model` тянет `@/lib/db`,
 * который на импорте требует `DATABASE_URL` — держать чистую логику
 * за этим требованием незачем.
 */

/** Столько провалов провайдера за окно — и модель считается недоступной. */
export const FAILURE_THRESHOLD = 3;

export const FAILURE_WINDOW_MS = 10 * 60 * 1000;

/**
 * Первое звено цепочки, где провалов за окно меньше порога. Если закрыты
 * все — последнее звено: пусть попытается и провалится с понятной причиной
 * в аудите, а не откажет заранее без единой попытки.
 */
export function pickModel(
  chain: string[],
  failuresByModel: Record<string, number>,
): { modelId: string; index: number } {
  const index = chain.findIndex((modelId) => (failuresByModel[modelId] ?? 0) < FAILURE_THRESHOLD);
  if (index >= 0) return { modelId: chain[index]!, index };

  const last = chain.length - 1;
  return { modelId: chain[last]!, index: last };
}
