/**
 * Персональный порог времени ответа для автоматизма — по уровню Блума,
 * а не единой медианой по всем ответам.
 *
 * Раньше `personalResponseBaseline` в `queries/progress.ts` брал медиану по
 * ВСЕМ верным ответам пользователя разом. Порог автоматизма от этого плыл:
 * узел уровня `recall` (быстрый по своей природе) намешивался с узлами
 * уровня `analyze` (медленный по своей природе, даже при полном владении).
 * Если в выборке преобладает recall, порог занижается — и apply/analyze
 * никогда не доходят до automated. Если преобладает analyze — наоборот,
 * recall слишком легко проходит порог.
 */

export type TimingSample = { responseTimeMs: number; cognitiveLevel: string };

/**
 * Меньше этого — медиана по уровню ненадёжна, используется общий запасной
 * вариант. Совпадает по духу с `MIN_SAMPLES` в `services/learner/profile.ts`.
 */
const MIN_LEVEL_SAMPLES = 8;

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? ((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2
    : (sorted[mid] as number);
}

/**
 * Базовое время ответа для конкретного уровня Блума.
 *
 * Данных по этому уровню мало — откатываемся к медиане по всем уровням
 * разом: грубый порог лучше, чем никакого, а как только уровень наберёт
 * `MIN_LEVEL_SAMPLES` наблюдений, порог сам уточнится.
 */
export function responseTimeBaselineMs(samples: TimingSample[], cognitiveLevel: string): number | null {
  const sameLevel = samples.filter((s) => s.cognitiveLevel === cognitiveLevel).map((s) => s.responseTimeMs);
  if (sameLevel.length >= MIN_LEVEL_SAMPLES) return median(sameLevel);

  const all = samples.map((s) => s.responseTimeMs);
  return median(all);
}
