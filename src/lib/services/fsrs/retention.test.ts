import { describe, expect, it } from 'vitest';

import { personalRequestRetention } from './retention';

describe('personalRequestRetention', () => {
  it('вес 0.5 (нейтральный) не сдвигает базовое значение', () => {
    expect(personalRequestRetention(0.5, 0.9)).toBeCloseTo(0.9, 5);
  });

  it('высокий вес узла поднимает retention', () => {
    expect(personalRequestRetention(1, 0.9)).toBeGreaterThan(0.9);
  });

  it('низкий вес узла опускает retention', () => {
    expect(personalRequestRetention(0, 0.9)).toBeLessThan(0.9);
  });

  it('не выходит за границы 0.8..0.97', () => {
    expect(personalRequestRetention(1, 0.97)).toBeLessThanOrEqual(0.97);
    expect(personalRequestRetention(0, 0.8)).toBeGreaterThanOrEqual(0.8);
  });
});
