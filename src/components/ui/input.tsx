import type { ComponentProps } from 'react';

import { cn } from '@/lib/utils';

export function Input({ className, ...props }: ComponentProps<'input'>) {
  return (
    <input
      className={cn(
        'h-9 w-full rounded-md border border-border bg-bg px-3 text-sm text-fg',
        'placeholder:text-fg-subtle disabled:opacity-50',
        className,
      )}
      {...props}
    />
  );
}

export function Textarea({ className, ...props }: ComponentProps<'textarea'>) {
  return (
    <textarea
      className={cn(
        'w-full rounded-md border border-border bg-bg px-3 py-2 text-sm text-fg',
        'placeholder:text-fg-subtle disabled:opacity-50',
        className,
      )}
      {...props}
    />
  );
}

/**
 * `htmlFor` обязателен на уровне типа: подпись, не связанная с полем, для
 * screen reader — просто текст рядом, а поле остаётся безымянным. Связь
 * задаётся на месте вызова, поэтому её нельзя обеспечить внутри примитива —
 * но можно сделать невозможным вызов без неё.
 */
export function Label({
  className,
  children,
  ...props
}: ComponentProps<'label'> & { htmlFor: string }) {
  return (
    <label className={cn('text-sm font-medium text-fg-muted', className)} {...props}>
      {children}
    </label>
  );
}
