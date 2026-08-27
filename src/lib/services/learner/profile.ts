import { DEFAULT_COGNITIVE_PROFILE, type CognitiveProfile } from '@/lib/db/schema/types';

/**
 * Расчёт когнитивного портрета из уже собранной телеметрии.
 *
 * Чистая функция без обращений к базе и без вызова модели. Причина не в
 * экономии: всё, что здесь считается, — арифметика с точным определением
 * (PRD §3 п.3 и п.5, §5). Отдавать её LLM значит платить лимитом за
 * недетерминированный ответ там, где есть детерминированный, и лишиться
 * возможности проверить результат тестом.
 *
 * До сих пор `users.cognitive_profile` никто не писал: значения читались
 * (`interleavingTolerance` в `GET /api/practice/next`), но навсегда
 * оставались значениями по умолчанию. Петля персонализации была разомкнута
 * ровно здесь.
 */

/** Ответ в том виде, в каком он нужен для расчёта. */
export type ProfileResponseSample = {
  isCorrect: boolean;
  partialScore: number;
  responseTimeMs: number;
  confidenceLevel: number | null;
  /** Была ли сессия перемешанной (`practice_sessions.interleaved`). */
  interleaved: boolean;
};

/** Повторение FSRS в том виде, в каком оно нужно для расчёта удержания. */
export type ProfileReviewSample = {
  scheduledDays: number;
  rating: 'again' | 'hard' | 'good' | 'easy';
};

/**
 * Ниже этого числа наблюдений оценка не считается: на трёх ответах любая
 * из этих величин — шум, а записанный шум неотличим от знания и начнёт
 * влиять на подбор заданий.
 */
const MIN_SAMPLES = 8;

/** Столько же нужно в каждой из двух групп, чтобы сравнивать их между собой. */
const MIN_GROUP_SAMPLES = 5;

/** Интервал, начиная с которого повторение считается «длинным» (PRD §5). */
const LONG_INTERVAL_DAYS = 7;

/**
 * Границы устойчивости к интерливингу. Ноль означал бы отказ от
 * перемешивания вовсе, а это желательная трудность по умолчанию
 * (Bjork & Bjork, 2011; Rohrer, 2012) — снижать её ниже 0.2 нельзя даже
 * при плохих результатах. Верхняя граница совпадает с максимумом,
 * который принимает `practiceNextQuerySchema`.
 */
const MIN_INTERLEAVING = 0.2;
const MAX_INTERLEAVING = 0.6;

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? ((sorted[middle - 1] as number) + (sorted[middle] as number)) / 2
    : (sorted[middle] as number);
}

function mean(values: number[]): number | null {
  return values.length === 0 ? null : values.reduce((a, b) => a + b, 0) / values.length;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Балл ответа: частичный зачёт учитывается, иначе `multi_select` считался бы провалом. */
function score(sample: ProfileResponseSample): number {
  return sample.isCorrect ? 1 : sample.partialScore;
}

/**
 * Медиана времени по верным ответам. Именно медиана, а не среднее: одна
 * отлучка от экрана посреди сессии сдвигает среднее на минуты, а медиану —
 * нет. Считается только по верным: время неверного ответа означает, сколько
 * человек сдавался, а не сколько занимает извлечение из памяти.
 */
export function computeAvgResponseTimeMs(samples: ProfileResponseSample[]): number | null {
  const correct = samples.filter((s) => s.isCorrect).map((s) => s.responseTimeMs);
  if (correct.length < MIN_SAMPLES) return null;
  const value = median(correct);
  return value === null ? null : Math.round(value);
}

/**
 * Смещение калибровки: средняя уверенность минус средняя точность,
 * обе в 0..1. Положительное — переоценка себя (Dunlosky & Rawson, 2012).
 *
 * Шкала 1–5 переводится как `(c − 1) / 4`, тем же способом, что в
 * `complete/route.ts` и `analytics.ts`: единица шкалы — это «совсем не
 * уверен», то есть ноль уверенности, а не 20 %.
 */
export function computeCalibrationBias(samples: ProfileResponseSample[]): number | null {
  const rated = samples.filter((s) => s.confidenceLevel !== null);
  if (rated.length < MIN_SAMPLES) return null;

  const confidence = mean(rated.map((s) => ((s.confidenceLevel as number) - 1) / 4));
  const accuracy = mean(rated.map(score));
  if (confidence === null || accuracy === null) return null;

  return clamp(confidence - accuracy, -1, 1);
}

/**
 * Доля успешных повторений среди тех, что случились после длинного
 * интервала. Это и есть удержание в смысле PRD §5: короткие интервалы
 * проверяют рабочую память, а не долговременную.
 */
export function computeRetentionIndex(reviews: ProfileReviewSample[]): number | null {
  const long = reviews.filter((r) => r.scheduledDays >= LONG_INTERVAL_DAYS);
  if (long.length < MIN_GROUP_SAMPLES) return null;
  return long.filter((r) => r.rating !== 'again').length / long.length;
}

/**
 * Устойчивость к перемешиванию — отношение точности в перемешанных сессиях
 * к точности в обычных.
 *
 * Смысл величины: интерливинг по определению снижает результат на
 * тренировке и повышает на отложенной проверке (Bjork & Bjork, 2011 —
 * желательные трудности). Вопрос не в том, падает ли точность, а насколько.
 * Провал вдвое означает, что смесь сейчас непосильна и долю надо снизить;
 * почти без потерь — что смесь можно усиливать.
 *
 * Отношение зажимается в 0.2…0.6, и это не косметика: значение уходит
 * прямо в `interleaveRatio`, а тот ограничен схемой запроса тем же
 * максимумом.
 */
export function computeInterleavingTolerance(
  samples: ProfileResponseSample[],
  fallback: number,
): number {
  const mixed = samples.filter((s) => s.interleaved);
  const blocked = samples.filter((s) => !s.interleaved);
  if (mixed.length < MIN_GROUP_SAMPLES || blocked.length < MIN_GROUP_SAMPLES) return fallback;

  const mixedAccuracy = mean(mixed.map(score));
  const blockedAccuracy = mean(blocked.map(score));
  if (mixedAccuracy === null || blockedAccuracy === null) return fallback;

  // Точность в обычных сессиях нулевая — сравнивать не с чем; менять
  // настройку по такому основанию хуже, чем не менять.
  if (blockedAccuracy === 0) return fallback;

  return clamp(mixedAccuracy / blockedAccuracy, MIN_INTERLEAVING, MAX_INTERLEAVING);
}

/**
 * Собирает профиль целиком. Прежние значения передаются отдельно и служат
 * запасным вариантом: величина, для которой данных пока не хватает, должна
 * остаться прежней, а не обнулиться — иначе каждая новая установка
 * стирала бы накопленную настройку.
 */
export function computeCognitiveProfile(params: {
  previous: CognitiveProfile;
  responses: ProfileResponseSample[];
  reviews: ProfileReviewSample[];
}): CognitiveProfile {
  const { previous, responses, reviews } = params;

  return {
    ...previous,
    avgResponseTimeMs: computeAvgResponseTimeMs(responses) ?? previous.avgResponseTimeMs,
    calibrationBias: computeCalibrationBias(responses) ?? previous.calibrationBias,
    retentionIndex: computeRetentionIndex(reviews) ?? previous.retentionIndex,
    interleavingTolerance: computeInterleavingTolerance(
      responses,
      previous.interleavingTolerance ?? DEFAULT_COGNITIVE_PROFILE.interleavingTolerance,
    ),
  };
}
