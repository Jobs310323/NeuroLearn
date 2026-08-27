import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import type { ComponentProps } from 'react';

import { cn } from '@/lib/utils';

// Классы вроде `bg-bg-elevated` / `text-fg-muted` генерируются Tailwind v4
// из токенов блока `@theme` в globals.css — отдельного конфига нет.
//
// Три варианта отвечают на три разных вопроса, а не «выглядят по-разному»:
// `default` — главное действие экрана (градиент aurora, и он же означает
// «здесь главное»); `secondary` — равноправная альтернатива (стекло);
// `ghost` — вспомогательное действие, которое не должно спорить с текстом.
// Четвёртая, `danger`, помечает необратимое.
const buttonVariants = cva(
  cn(
    'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium',
    'transition-[color,background-color,box-shadow,transform] duration-[var(--duration-fast)] ease-[var(--ease-quart-out)]',
    'disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0',
    // Активное нажатие — единственное место, где кнопка меняет размер:
    // это тактильная обратная связь, а не украшение.
    'active:scale-[0.98]',
  ),
  {
    variants: {
      variant: {
        default: 'aurora',
        secondary: 'glass text-fg hover:bg-bg-hover',
        ghost: 'text-fg-muted hover:bg-bg-hover hover:text-fg',
        danger: 'bg-red-600/90 text-white hover:bg-red-600',
      },
      size: {
        sm: 'h-8 px-3',
        md: 'h-9 px-4',
        lg: 'h-10 px-5',
        // Иконочная кнопка на мобильном должна оставаться удобной целью:
        // 44px — практический минимум касания (WCAG 2.5.5).
        icon: 'size-9 max-md:size-11',
      },
    },
    defaultVariants: { variant: 'default', size: 'md' },
  },
);

export function Button({
  className,
  variant,
  size,
  asChild = false,
  ...props
}: ComponentProps<'button'> & VariantProps<typeof buttonVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot : 'button';
  return <Comp className={cn(buttonVariants({ variant, size }), className)} {...props} />;
}

export { buttonVariants };
