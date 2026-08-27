'use client';

import { Info, X } from 'lucide-react';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { useTranslations } from '@/lib/i18n/provider';
import type { Hint, HintOutcome } from '@/lib/practice/hints/types';
import { cn } from '@/lib/utils';

/**
 * Карточка подсказки в практике.
 *
 * Не модалка и ничего не перекрывает: подсказка появляется рядом с заданием и
 * не мешает отвечать. Модалку она не открывает и сама — действие ведёт на
 * экран, а не выбрасывает поверх текущего.
 *
 * Три вещи всегда доступны: закрыть, посмотреть основание («почему это
 * показано») и отключить этот тип навсегда. Последнее — не отговорка на
 * случай жалоб, а часть контракта: система, которая что-то советует, обязана
 * уметь замолчать.
 *
 * `aria-live="polite"` — карточка появляется без действия пользователя, и
 * screen reader обязан сообщить о ней, но не перебивая текущее чтение.
 */
export function HintCard({
  hint,
  onOutcome,
}: {
  hint: Hint;
  onOutcome: (outcome: HintOutcome, hint: Hint) => void;
}) {
  const t = useTranslations();
  const [showReason, setShowReason] = useState(false);

  const actionLabel = actionLabelKey(hint);

  return (
    <aside
      aria-live="polite"
      className={cn(
        'rounded-card border border-border bg-bg-elevated/80 p-3 text-sm backdrop-blur',
        'motion-safe:animate-[hint-in_250ms_cubic-bezier(0.25,1,0.5,1)]',
      )}
      data-hint-rule={hint.ruleId}
    >
      <div className="flex items-start gap-2">
        <Info className="mt-0.5 size-4 shrink-0 text-fg-subtle" aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="text-fg">{t(hint.messageKey, hint.values)}</p>

          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            {hint.action && actionLabel ? (
              <Button size="sm" onClick={() => onOutcome('acted', hint)}>
                {t(actionLabel)}
              </Button>
            ) : null}

            <Button
              size="sm"
              variant="ghost"
              aria-expanded={showReason}
              onClick={() => setShowReason(!showReason)}
            >
              {t('hints.why')}
            </Button>

            <Button size="sm" variant="ghost" onClick={() => onOutcome('muted', hint)}>
              {t('hints.mute')}
            </Button>
          </div>

          {showReason ? (
            <p className="mt-2 text-xs text-fg-subtle">{t(hint.reasonKey)}</p>
          ) : null}
        </div>

        <button
          type="button"
          aria-label={t('hints.dismiss')}
          onClick={() => onOutcome('dismissed', hint)}
          className="rounded p-1 text-fg-subtle transition-colors hover:bg-bg-hover hover:text-fg"
        >
          <X className="size-3.5" aria-hidden />
        </button>
      </div>
    </aside>
  );
}

/** Подпись действия живёт рядом с текстом подсказки в том же файле локали. */
function actionLabelKey(hint: Hint): string | null {
  if (!hint.action) return null;
  const group = hint.messageKey.split('.')[1];
  return group ? `hints.${group}.action` : null;
}
