import { describe, expect, it } from 'vitest';

import { responseTimeBaselineMs, type TimingSample } from './automaticity';

function samples(count: number, cognitiveLevel: string, responseTimeMs: number): TimingSample[] {
  return Array.from({ length: count }, () => ({ cognitiveLevel, responseTimeMs }));
}

describe('responseTimeBaselineMs', () => {
  it('на достаточной выборке по уровню считает медиану именно этого уровня', () => {
    const data = [...samples(8, 'recall', 1000), ...samples(8, 'analyze', 9000)];
    expect(responseTimeBaselineMs(data, 'recall')).toBe(1000);
    expect(responseTimeBaselineMs(data, 'analyze')).toBe(9000);
  });

  it('смешанные уровни в одной выборке не искажают порог друг друга', () => {
    // Много быстрых recall и мало analyze — глобальная медиана легла бы
    // около recall и сделала бы automaticity почти недостижимым для analyze.
    const data = [...samples(20, 'recall', 1000), ...samples(20, 'analyze', 9000)];
    expect(responseTimeBaselineMs(data, 'analyze')).toBe(9000);
  });

  it('на малой выборке по уровню откатывается к общей медиане', () => {
    const data = [...samples(20, 'recall', 1000), ...samples(3, 'analyze', 9000)];
    // analyze: всего 3 наблюдения < MIN_LEVEL_SAMPLES — берём медиану по всем.
    expect(responseTimeBaselineMs(data, 'analyze')).toBe(1000);
  });

  it('без данных возвращает null', () => {
    expect(responseTimeBaselineMs([], 'recall')).toBeNull();
  });
});
