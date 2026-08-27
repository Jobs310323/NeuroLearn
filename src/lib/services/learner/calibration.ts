/**
 * Разрыв калибровки: насколько уверенность расходится с фактической точностью.
 *
 * Вынесено отдельным модулем, потому что читателей стало трое: отчёт о
 * сессии (`complete`), когнитивный портрет (`profile.ts`) и правило
 * метакогнитивной подсказки в практике. Три копии одной арифметики
 * разъехались бы на первом же уточнении порога, и «переоценка себя» в
 * отчёте перестала бы совпадать с «переоценкой себя» в подсказке.
 *
 * Шкала уверенности 1..5 нормализуется в 0..1 линейно: 1 → 0 («угадал»),
 * 5 → 1 («знаю точно»). Величина сопоставима с долей верных ответов,
 * поэтому разность имеет смысл.
 */

export type CalibrationSample = { isCorrect: boolean; confidenceLevel: number | null };

export function normalizeConfidence(level: number): number {
  return (level - 1) / 4;
}

export type CalibrationSummary = {
  meanConfidence: number;
  accuracy: number;
  /** >0 — переоценка себя, <0 — недооценка. */
  gap: number;
  sampleSize: number;
};

/** `null`, если уверенность не собрана ни разу: сравнивать не с чем. */
export function summarizeCalibration(samples: CalibrationSample[]): CalibrationSummary | null {
  const rated = samples.filter((s) => s.confidenceLevel !== null);
  if (rated.length === 0) return null;

  const meanConfidence =
    rated.reduce((sum, s) => sum + normalizeConfidence(s.confidenceLevel as number), 0) /
    rated.length;
  const accuracy = rated.filter((s) => s.isCorrect).length / rated.length;

  return {
    meanConfidence,
    accuracy,
    gap: meanConfidence - accuracy,
    sampleSize: rated.length,
  };
}

/**
 * Порог заметной переоценки. 0.15 — то же число, что показывает отчёт о
 * сессии фразой «заметная переоценка себя»; менять его надо в одном месте.
 */
export const NOTABLE_OVERCONFIDENCE = 0.15;

/**
 * Единичный признак разрыва: высокая уверенность при неверном ответе.
 *
 * Это самый информативный случай метакогнитивной ошибки — человек не просто
 * ошибся, он не знал, что не знает. Ошибка при низкой уверенности так не
 * читается: там модель себя как раз верная.
 */
export function isOverconfidentMiss(
  sample: CalibrationSample,
  minConfidence = 4,
): boolean {
  return (
    !sample.isCorrect &&
    sample.confidenceLevel !== null &&
    sample.confidenceLevel >= minConfidence
  );
}
