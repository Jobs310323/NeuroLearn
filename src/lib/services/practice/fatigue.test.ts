import { describe, expect, it } from 'vitest';

import { responseTimeVariability } from './fatigue';

describe('responseTimeVariability', () => {
  it('на малой выборке не считает', () => {
    const samples = [1000, 1200, 900].map((responseTimeMs) => ({ responseTimeMs, isCorrect: true }));
    expect(responseTimeVariability(samples)).toBeNull();
  });

  it('ровный темп даёт низкий коэффициент вариации', () => {
    const samples = [1000, 1010, 990, 1005, 995, 1000].map((responseTimeMs) => ({
      responseTimeMs,
      isCorrect: true,
    }));
    expect(responseTimeVariability(samples)).toBeLessThan(0.05);
  });

  it('рваный темп даёт высокий коэффициент вариации', () => {
    const samples = [1000, 5000, 800, 6000, 900, 7000].map((responseTimeMs) => ({
      responseTimeMs,
      isCorrect: true,
    }));
    expect(responseTimeVariability(samples)).toBeGreaterThan(0.5);
  });

  it('неверные ответы в расчёт не идут', () => {
    const steady = [1000, 1010, 990, 1005, 995].map((responseTimeMs) => ({ responseTimeMs, isCorrect: true }));
    const withNoise = [...steady, { responseTimeMs: 60_000, isCorrect: false }];
    expect(responseTimeVariability(withNoise)).toBe(responseTimeVariability(steady));
  });
});
