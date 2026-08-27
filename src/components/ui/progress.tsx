import { cn } from '@/lib/utils';

/**
 * Полоса прогресса.
 *
 * Цвет задаётся снаружи и остаётся семантическим: полоса прочности узла
 * красится цветом его статуса, а не цветом «прогресс». «Жидкая» заливка —
 * только материальность поверх, она ничего не сообщает и при
 * `prefers-reduced-motion` выключается целиком.
 *
 * `role="progressbar"` с числами обязателен: полоса без них для screen reader
 * — пустой div, а число прочности — то самое, ради чего она нарисована.
 */
export function Progress({
  value,
  max = 100,
  color = 'var(--color-accent)',
  label,
  liquid = false,
  className,
}: {
  value: number;
  max?: number;
  color?: string;
  label: string;
  liquid?: boolean;
  className?: string;
}) {
  const clamped = Math.max(0, Math.min(max, value));
  const percent = max === 0 ? 0 : (clamped / max) * 100;

  return (
    <div
      role="progressbar"
      aria-valuenow={clamped}
      aria-valuemin={0}
      aria-valuemax={max}
      aria-label={label}
      className={cn('h-1.5 overflow-hidden rounded-full bg-bg', className)}
    >
      <div
        className={cn(
          'h-full rounded-full transition-[width] duration-[var(--duration-slow)] ease-[var(--ease-quart-out)]',
          liquid && 'progress-liquid',
        )}
        style={{
          // Минимум 2%, чтобы нулевая полоса не выглядела сломанной: она
          // означает «ещё не начато», а не «элемент не отрисовался».
          width: `${Math.max(percent > 0 ? 2 : 0, percent)}%`,
          backgroundColor: color,
        }}
      />
    </div>
  );
}
