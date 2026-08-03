'use client';

import * as Tooltip from '@radix-ui/react-tooltip';
import { FlaskConical } from 'lucide-react';

import { CITATIONS, formatCitation, scholarUrl, type CitationKey } from '@/lib/science/citations';
import { cn } from '@/lib/utils';

/**
 * Тултип «Почему мы так делаем?».
 *
 * Ставится рядом с каждой механикой, которая выглядит контринтуитивно:
 * тест до теории, перемешанная практика, скрытый до конца сессии результат.
 * Показывает правило продукта, вывод исследования и ссылку на поиск работы.
 */
export function ScienceHint({
  citation,
  className,
  side = 'top',
}: {
  citation: CitationKey;
  className?: string;
  side?: 'top' | 'right' | 'bottom' | 'left';
}) {
  const c = CITATIONS[citation];

  return (
    <Tooltip.Provider delayDuration={150}>
      <Tooltip.Root>
        <Tooltip.Trigger asChild>
          <button
            type="button"
            aria-label={`Почему мы так делаем: ${c.productRule}`}
            className={cn(
              'inline-flex size-5 items-center justify-center rounded text-fg-subtle',
              'transition-colors hover:bg-bg-hover hover:text-accent',
              className,
            )}
          >
            <FlaskConical className="size-3.5" />
          </button>
        </Tooltip.Trigger>
        <Tooltip.Portal>
          <Tooltip.Content
            side={side}
            sideOffset={6}
            collisionPadding={12}
            className="z-50 max-w-sm rounded-card border border-border bg-bg-elevated p-4 text-sm shadow-xl"
          >
            <p className="font-medium text-fg">Почему мы так делаем</p>
            <p className="mt-1 text-fg-muted">{c.productRule}</p>

            <p className="mt-3 border-t border-border pt-3 text-fg-muted">{c.finding}</p>

            <a
              href={scholarUrl(citation)}
              target="_blank"
              rel="noreferrer noopener"
              className="mt-2 block text-xs text-accent underline-offset-2 hover:underline"
            >
              {formatCitation(citation)}
            </a>

            <Tooltip.Arrow className="fill-[var(--color-border)]" />
          </Tooltip.Content>
        </Tooltip.Portal>
      </Tooltip.Root>
    </Tooltip.Provider>
  );
}
