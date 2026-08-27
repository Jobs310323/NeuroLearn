'use client';

import { useRef, type TouchEvent } from 'react';

/**
 * Свайп влево/вправо для перехода между заданиями на мобильном.
 *
 * Три условия, без которых свайп мешает больше, чем помогает:
 *
 * 1. Порог по расстоянию (60px) — иначе случайное касание при прокрутке
 *    переключает задание, и человек теряет набранный ответ.
 * 2. Порог по углу — жест засчитывается, только если горизонтальное смещение
 *    заметно больше вертикального. Без этого прокрутка длинного задания
 *    постоянно срабатывает как свайп.
 * 3. Ограничение по времени: медленное перетаскивание пальцем — это чаще
 *    выделение текста, чем намерение перелистнуть.
 *
 * Свайп всегда дублирует видимую кнопку и никогда не остаётся единственным
 * способом сделать действие: жест, о котором нельзя догадаться, для части
 * людей не существует вовсе.
 */

export const SWIPE_MIN_DISTANCE = 60;
export const SWIPE_MAX_DURATION_MS = 600;
/** Горизонталь должна превышать вертикаль во столько раз. */
export const SWIPE_AXIS_RATIO = 1.6;

export type SwipeDirection = 'left' | 'right';

export function classifySwipe(input: {
  dx: number;
  dy: number;
  durationMs: number;
}): SwipeDirection | null {
  const { dx, dy, durationMs } = input;
  if (durationMs > SWIPE_MAX_DURATION_MS) return null;
  if (Math.abs(dx) < SWIPE_MIN_DISTANCE) return null;
  if (Math.abs(dx) < Math.abs(dy) * SWIPE_AXIS_RATIO) return null;
  return dx < 0 ? 'left' : 'right';
}

export function useSwipe(onSwipe: (direction: SwipeDirection) => void) {
  const start = useRef<{ x: number; y: number; at: number } | null>(null);

  return {
    onTouchStart: (event: TouchEvent) => {
      const touch = event.touches[0];
      if (!touch) return;
      start.current = { x: touch.clientX, y: touch.clientY, at: Date.now() };
    },
    onTouchEnd: (event: TouchEvent) => {
      const from = start.current;
      const touch = event.changedTouches[0];
      start.current = null;
      if (!from || !touch) return;

      const direction = classifySwipe({
        dx: touch.clientX - from.x,
        dy: touch.clientY - from.y,
        durationMs: Date.now() - from.at,
      });
      if (direction) onSwipe(direction);
    },
  };
}
