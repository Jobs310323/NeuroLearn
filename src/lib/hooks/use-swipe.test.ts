import { describe, expect, it } from 'vitest';

import {
  SWIPE_MAX_DURATION_MS,
  SWIPE_MIN_DISTANCE,
  classifySwipe,
} from './use-swipe';

/**
 * Свайп, срабатывающий не вовремя, стоит человеку набранного ответа. Поэтому
 * все три ограничителя проверяются по отдельности: расстояние, угол и время.
 */
describe('classifySwipe', () => {
  it('уверенный горизонтальный жест распознаётся', () => {
    expect(classifySwipe({ dx: -120, dy: 10, durationMs: 200 })).toBe('left');
    expect(classifySwipe({ dx: 120, dy: -10, durationMs: 200 })).toBe('right');
  });

  it('короткое движение не считается жестом', () => {
    expect(
      classifySwipe({ dx: -(SWIPE_MIN_DISTANCE - 1), dy: 0, durationMs: 100 }),
    ).toBeNull();
  });

  it('прокрутка по вертикали не превращается в свайп', () => {
    // Палец ушёл вниз на 200px и вбок на 80: это скролл, а не перелистывание.
    expect(classifySwipe({ dx: -80, dy: 200, durationMs: 300 })).toBeNull();
  });

  it('диагональ засчитывается, только если горизонталь заметно больше', () => {
    expect(classifySwipe({ dx: -100, dy: 30, durationMs: 200 })).toBe('left');
    expect(classifySwipe({ dx: -100, dy: 90, durationMs: 200 })).toBeNull();
  });

  it('медленное перетаскивание — чаще выделение текста, чем жест', () => {
    expect(
      classifySwipe({ dx: -200, dy: 0, durationMs: SWIPE_MAX_DURATION_MS + 1 }),
    ).toBeNull();
  });

  it('касание без движения ничего не запускает', () => {
    expect(classifySwipe({ dx: 0, dy: 0, durationMs: 50 })).toBeNull();
  });
});
