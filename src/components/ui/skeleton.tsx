import type { ComponentProps } from 'react';

import { cn } from '@/lib/utils';

/**
 * Скелетон загрузки.
 *
 * Показывает форму будущего содержимого, а не спиннер: спиннер сообщает «идёт
 * загрузка», скелетон — ещё и «загружается вот это», и переход к готовым
 * данным не сдвигает раскладку.
 *
 * `aria-hidden` обязателен: для screen reader пустая мерцающая полоса — шум.
 * Состояние загрузки сообщается отдельно, текстом в `aria-live`.
 */
export function Skeleton({ className, ...props }: ComponentProps<'div'>) {
  return <div aria-hidden className={cn('skeleton', className)} {...props} />;
}

/** Скелетон карточки списка: две строки текста и мета-строка под ними. */
export function SkeletonCard({ className }: { className?: string }) {
  return (
    <div className={cn('rounded-card border border-border p-4', className)}>
      <Skeleton className="h-4 w-2/5" />
      <Skeleton className="mt-2.5 h-3 w-full" />
      <Skeleton className="mt-1.5 h-3 w-4/5" />
      <Skeleton className="mt-3 h-2.5 w-1/4" />
    </div>
  );
}

/**
 * Список скелетонов с текстовым дублем для screen reader. Именно здесь, а не
 * в каждом вызове: забыть `aria-live` легко, а заметить пропажу — нет.
 */
export function SkeletonList({
  count = 3,
  label = 'Загружаю…',
  className,
}: {
  count?: number;
  label?: string;
  className?: string;
}) {
  return (
    <div className={cn('flex flex-col gap-3', className)}>
      <p className="sr-only" aria-live="polite">
        {label}
      </p>
      {Array.from({ length: count }, (_, index) => (
        <SkeletonCard key={index} />
      ))}
    </div>
  );
}
