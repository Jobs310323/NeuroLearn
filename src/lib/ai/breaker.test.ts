import { describe, expect, it } from 'vitest';

import { pickModel } from './breaker';

/**
 * Решение circuit breaker'а. Счётчики провалов приходят из аудита
 * `ai_generations` — здесь проверяется только выбор звена по ним, без БД.
 */

const CHAIN = ['primary:free', 'fallback-1', 'fallback-2'];

describe('pickModel', () => {
  it('берёт основную модель, пока провалов меньше порога', () => {
    expect(pickModel(CHAIN, { 'primary:free': 2 })).toEqual({ modelId: 'primary:free', index: 0 });
  });

  it('переключается на резерв, когда основная набрала порог', () => {
    const picked = pickModel(CHAIN, { 'primary:free': 3, 'fallback-1': 0 });
    expect(picked).toEqual({ modelId: 'fallback-1', index: 1 });
  });

  it('проходит цепочку дальше, пока не найдёт живое звено', () => {
    const picked = pickModel(CHAIN, { 'primary:free': 5, 'fallback-1': 3, 'fallback-2': 1 });
    expect(picked).toEqual({ modelId: 'fallback-2', index: 2 });
  });

  it('при полностью открытом breaker\'е отдаёт последнее звено, а не отказ', () => {
    const picked = pickModel(CHAIN, { 'primary:free': 9, 'fallback-1': 9, 'fallback-2': 9 });
    expect(picked).toEqual({ modelId: 'fallback-2', index: 2 });
  });

  it('без резервов остаётся на основной модели даже в breaker\'е', () => {
    expect(pickModel(['solo'], { solo: 42 })).toEqual({ modelId: 'solo', index: 0 });
  });

  it('модель без записей в аудите считается исправной', () => {
    expect(pickModel(CHAIN, {})).toEqual({ modelId: 'primary:free', index: 0 });
  });

  it('index 0 отличает primary от fallback — на нём строится поле tier', () => {
    expect(pickModel(CHAIN, { 'primary:free': 3 }).index).toBeGreaterThan(0);
  });
});
