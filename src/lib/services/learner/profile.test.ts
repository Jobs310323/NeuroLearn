import { describe, expect, it } from 'vitest';

import { DEFAULT_COGNITIVE_PROFILE } from '@/lib/db/schema/types';

import {
  computeAvgResponseTimeMs,
  computeCalibrationBias,
  computeCognitiveProfile,
  computeInterleavingTolerance,
  computeRetentionIndex,
  type ProfileResponseSample,
  type ProfileReviewSample,
} from './profile';

/**
 * Портрет ученика управляет подбором заданий, поэтому проверяется в первую
 * очередь не «считает ли формула», а два свойства безопасности: на малой
 * выборке величина не выставляется вовсе, а уже накопленное значение не
 * затирается пустотой. Ошибка здесь тихая — она не падает, а начинает
 * незаметно портить практику.
 */

function response(overrides: Partial<ProfileResponseSample> = {}): ProfileResponseSample {
  return {
    isCorrect: true,
    partialScore: 1,
    responseTimeMs: 4000,
    confidenceLevel: 3,
    interleaved: false,
    ...overrides,
  };
}

function times<T>(count: number, make: (index: number) => T): T[] {
  return Array.from({ length: count }, (_, index) => make(index));
}

describe('computeAvgResponseTimeMs', () => {
  it('на короткой выборке не считает', () => {
    expect(computeAvgResponseTimeMs(times(7, () => response()))).toBeNull();
  });

  it('берёт медиану, а не среднее — одна отлучка не сдвигает результат', () => {
    const samples = [...times(9, () => response({ responseTimeMs: 3000 })), response({ responseTimeMs: 600_000 })];
    expect(computeAvgResponseTimeMs(samples)).toBe(3000);
  });

  it('считает только по верным ответам', () => {
    const samples = [
      ...times(8, () => response({ responseTimeMs: 2000 })),
      ...times(8, () => response({ isCorrect: false, partialScore: 0, responseTimeMs: 90_000 })),
    ];
    expect(computeAvgResponseTimeMs(samples)).toBe(2000);
  });
});

describe('computeCalibrationBias', () => {
  it('переоценка себя даёт положительное смещение', () => {
    // Уверенность 5 из 5 при точности 50 % — ровно тот случай, ради которого
    // величина и заведена (Dunlosky & Rawson, 2012).
    const samples = [
      ...times(5, () => response({ confidenceLevel: 5 })),
      ...times(5, () => response({ confidenceLevel: 5, isCorrect: false, partialScore: 0 })),
    ];
    expect(computeCalibrationBias(samples)).toBeCloseTo(0.5, 5);
  });

  it('недооценка даёт отрицательное', () => {
    const samples = times(10, () => response({ confidenceLevel: 1 }));
    expect(computeCalibrationBias(samples)).toBeCloseTo(-1, 5);
  });

  it('ответы без уверенности в расчёт не идут', () => {
    const samples = [
      ...times(4, () => response({ confidenceLevel: 5 })),
      ...times(20, () => response({ confidenceLevel: null, isCorrect: false, partialScore: 0 })),
    ];
    // Оценённых всего 4 — меньше порога, значит величина не считается вовсе.
    expect(computeCalibrationBias(samples)).toBeNull();
  });

  it('частичный зачёт учитывается как частичная правильность', () => {
    const samples = times(10, () => response({ confidenceLevel: 3, isCorrect: false, partialScore: 0.5 }));
    expect(computeCalibrationBias(samples)).toBeCloseTo(0, 5);
  });
});

describe('computeRetentionIndex', () => {
  function review(overrides: Partial<ProfileReviewSample> = {}): ProfileReviewSample {
    return { scheduledDays: 10, rating: 'good', ...overrides };
  }

  it('короткие интервалы не считаются удержанием', () => {
    expect(computeRetentionIndex(times(20, () => review({ scheduledDays: 3 })))).toBeNull();
  });

  it('доля успешных среди длинных интервалов', () => {
    const reviews = [
      ...times(3, () => review()),
      ...times(2, () => review({ rating: 'again' })),
      // Короткие интервалы в знаменатель не попадают.
      ...times(10, () => review({ scheduledDays: 1, rating: 'again' })),
    ];
    expect(computeRetentionIndex(reviews)).toBeCloseTo(0.6, 5);
  });
});

describe('computeInterleavingTolerance', () => {
  const FALLBACK = 0.5;

  it('без одной из групп оставляет прежнее значение', () => {
    const onlyBlocked = times(20, () => response());
    expect(computeInterleavingTolerance(onlyBlocked, FALLBACK)).toBe(FALLBACK);
  });

  it('провал в перемешанном режиме снижает долю, но не до нуля', () => {
    const samples = [
      ...times(10, () => response({ interleaved: false })),
      ...times(10, () => response({ interleaved: true, isCorrect: false, partialScore: 0 })),
    ];
    // Перемешивание — желательная трудность по умолчанию (Bjork & Bjork, 2011),
    // отказываться от него совсем нельзя даже при нулевой точности.
    expect(computeInterleavingTolerance(samples, FALLBACK)).toBe(0.2);
  });

  it('успех в перемешанном режиме поднимает долю до потолка схемы запроса', () => {
    const samples = [
      ...times(10, () => response({ interleaved: false })),
      ...times(10, () => response({ interleaved: true })),
    ];
    expect(computeInterleavingTolerance(samples, FALLBACK)).toBe(0.6);
  });

  it('нулевая точность в обычных сессиях — сравнивать не с чем', () => {
    const samples = [
      ...times(10, () => response({ interleaved: false, isCorrect: false, partialScore: 0 })),
      ...times(10, () => response({ interleaved: true })),
    ];
    expect(computeInterleavingTolerance(samples, FALLBACK)).toBe(FALLBACK);
  });
});

describe('computeCognitiveProfile', () => {
  it('нехватка данных не затирает накопленное', () => {
    const previous = {
      ...DEFAULT_COGNITIVE_PROFILE,
      avgResponseTimeMs: 3500,
      calibrationBias: 0.2,
      retentionIndex: 0.85,
      interleavingTolerance: 0.45,
    };

    const profile = computeCognitiveProfile({ previous, responses: [], reviews: [] });

    expect(profile).toEqual(previous);
  });

  it('поля, не выводимые из телеметрии, остаются как были', () => {
    const previous = {
      ...DEFAULT_COGNITIVE_PROFILE,
      desirableDifficulty: 'high' as const,
      preferredSessionMinutes: 35,
    };

    const profile = computeCognitiveProfile({
      previous,
      responses: times(20, () => response()),
      reviews: [],
    });

    expect(profile.desirableDifficulty).toBe('high');
    expect(profile.preferredSessionMinutes).toBe(35);
    expect(profile.avgResponseTimeMs).toBe(4000);
  });
});
