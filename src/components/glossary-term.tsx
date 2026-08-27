'use client';

import * as Tooltip from '@radix-ui/react-tooltip';

import { useTranslations } from '@/lib/i18n/provider';
import { cn } from '@/lib/utils';

/**
 * Тултип-глоссарий.
 *
 * Отличается от `ScienceHint` по назначению: тот объясняет, ПОЧЕМУ механика
 * устроена контринтуитивно, и ссылается на исследование. Этот — просто
 * говорит, что означает слово. Смешивать их было бы ошибкой: человек,
 * впервые увидевший «JOK», не хочет читать про Koriat, ему нужно понять
 * подпись под шкалой.
 *
 * Термин остаётся текстом, а не ссылкой: он не ведёт никуда, и подчёркнутая
 * ссылка обещала бы переход, которого не будет. Пунктирная граница — принятая
 * пометка «здесь есть пояснение».
 */

export const GLOSSARY_KEYS = [
  'interleaving',
  'jok',
  'calibration',
  'strength',
  'automaticity',
  'fsrs',
] as const;

export type GlossaryKey = (typeof GLOSSARY_KEYS)[number];

export function GlossaryTerm({
  term,
  children,
  className,
}: {
  term: GlossaryKey;
  children?: React.ReactNode;
  className?: string;
}) {
  const t = useTranslations();
  const label = t(`glossary.${term}.term`);
  const definition = t(`glossary.${term}.definition`);

  return (
    <Tooltip.Provider delayDuration={300}>
      <Tooltip.Root>
        <Tooltip.Trigger asChild>
          <button
            type="button"
            // Кнопка, а не span: пояснение обязано открываться и с клавиатуры.
            aria-label={`${label}: ${definition}`}
            className={cn(
              'cursor-help border-b border-dashed border-current text-inherit',
              className,
            )}
          >
            {children ?? label}
          </button>
        </Tooltip.Trigger>
        <Tooltip.Portal>
          <Tooltip.Content
            side="top"
            sideOffset={6}
            collisionPadding={12}
            className="z-50 max-w-xs rounded-card border border-border bg-bg-elevated p-3 text-sm shadow-xl"
          >
            <p className="font-medium text-fg">{label}</p>
            <p className="mt-1 text-xs leading-relaxed text-fg-muted">{definition}</p>
            <Tooltip.Arrow className="fill-[var(--color-border)]" />
          </Tooltip.Content>
        </Tooltip.Portal>
      </Tooltip.Root>
    </Tooltip.Provider>
  );
}
