import { describe, expect, it, vi } from 'vitest';

/**
 * Отбор персональных весов FSRS перед передачей в планировщик.
 *
 * Проверялось на ts-fsrs 5.4: неподходящую длину он разбирает сам (берёт веса
 * по умолчанию, 17 значений доливает до 21), а `NaN` и `Infinity` принимает
 * молча. Поэтому здесь фиксируется ровно одно правило — конечность значений.
 *
 * `@/lib/db` замокан: `engine.ts` тянет его на загрузке модуля.
 */

vi.mock('@/lib/db', () => ({ db: {} }));

const { usableWeights } = await import('./engine');

const valid = Array.from({ length: 21 }, (_, i) => 0.1 * (i + 1));

describe('usableWeights', () => {
  it('пропускает нормальный массив без изменений', () => {
    expect(usableWeights(valid)).toBe(valid);
  });

  it('отсутствие весов — не ошибка, просто дефолт планировщика', () => {
    expect(usableWeights(null)).toBeNull();
    expect(usableWeights(undefined)).toBeNull();
  });

  it('пустой массив не передаётся в планировщик', () => {
    expect(usableWeights([])).toBeNull();
  });

  it('NaN отбрасывает весь набор', () => {
    expect(usableWeights([...valid.slice(0, 20), Number.NaN])).toBeNull();
  });

  it('Infinity отбрасывает весь набор', () => {
    expect(usableWeights([Number.POSITIVE_INFINITY, ...valid.slice(1)])).toBeNull();
  });

  it('длину не трогает — это забота ts-fsrs', () => {
    const short = valid.slice(0, 17);
    expect(usableWeights(short)).toBe(short);
  });
});
