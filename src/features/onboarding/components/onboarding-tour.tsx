'use client';

import { ArrowRight, X } from 'lucide-react';
import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

import { TOUR_STEPS } from '../lib/tour-steps';

/**
 * Вводный тур из пяти шагов.
 *
 * Показывается один раз и закрывается навсегда — и пропуск, и прохождение
 * сохраняются в профиле. Тур, всплывающий второй раз, читается как ошибка
 * приложения, а не как забота.
 *
 * Диалог не блокирует работу: его можно закрыть в любой момент, и ссылка
 * «Посмотреть» ведёт на настоящий экран, а не на его имитацию. Показывать
 * скриншот того, что и так рядом, — способ рассказать о продукте, не дав
 * его потрогать.
 */
export function OnboardingTour({ initialStep = 0 }: { initialStep?: number }) {
  const [step, setStep] = useState(Math.min(initialStep, TOUR_STEPS.length - 1));
  const [open, setOpen] = useState(true);
  const dialogRef = useRef<HTMLDivElement>(null);

  const persist = useCallback(async (body: Record<string, unknown>) => {
    await fetch('/api/settings/onboarding', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      // Провал записи не должен запирать человека в туре: экран уже закрыт,
      // а при следующем визите тур просто покажется снова.
    }).catch(() => {});
  }, []);

  const skip = useCallback(() => {
    setOpen(false);
    void persist({ skipped: true, lastStep: step });
  }, [persist, step]);

  const finish = useCallback(() => {
    setOpen(false);
    void persist({ completed: true, lastStep: TOUR_STEPS.length });
  }, [persist]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') skip();
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [skip]);

  useEffect(() => {
    if (open) dialogRef.current?.focus();
  }, [open, step]);

  if (!open) return null;

  const current = TOUR_STEPS[step]!;
  const isLast = step === TOUR_STEPS.length - 1;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center p-4 sm:items-center">
      <button
        type="button"
        aria-label="Закрыть тур"
        onClick={skip}
        className="absolute inset-0 cursor-default bg-black/60 backdrop-blur-sm"
      />

      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="tour-title"
        tabIndex={-1}
        className="relative w-full max-w-lg rounded-card border border-border bg-bg-elevated p-5 shadow-2xl outline-none"
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xs text-fg-subtle">
              Шаг {step + 1} из {TOUR_STEPS.length}
            </p>
            <h2 id="tour-title" className="mt-1 text-lg font-medium text-fg">
              {current.title}
            </h2>
          </div>
          <button
            type="button"
            aria-label="Пропустить тур"
            onClick={skip}
            className="rounded p-1 text-fg-subtle transition-colors hover:bg-bg-hover hover:text-fg"
          >
            <X className="size-4" aria-hidden />
          </button>
        </div>

        <p className="mt-3 text-sm leading-relaxed text-fg-muted">{current.body}</p>

        {current.highlight ? (
          <p className="mt-3 rounded-md border border-border bg-bg p-2.5 text-xs text-fg-subtle">
            {current.highlight}
          </p>
        ) : null}

        {/* Индикатор шагов доступен и без цвета: у активного есть подпись. */}
        <ol className="mt-4 flex gap-1.5" aria-label="Шаги тура">
          {TOUR_STEPS.map((item, index) => (
            <li key={item.id} className="flex-1">
              <button
                type="button"
                onClick={() => setStep(index)}
                aria-current={index === step ? 'step' : undefined}
                aria-label={`Шаг ${index + 1}: ${item.title}`}
                className={cn(
                  'h-1 w-full rounded-full transition-colors',
                  index === step
                    ? 'bg-accent'
                    : index < step
                      ? 'bg-border-strong'
                      : 'bg-border',
                )}
              />
            </li>
          ))}
        </ol>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          {current.href ? (
            <Button size="sm" variant="secondary" asChild>
              <Link href={current.href} onClick={finish}>
                Посмотреть
              </Link>
            </Button>
          ) : null}

          {isLast ? (
            <Button size="sm" onClick={finish}>
              Понятно, начать
            </Button>
          ) : (
            <Button size="sm" onClick={() => setStep(step + 1)}>
              Дальше
              <ArrowRight aria-hidden />
            </Button>
          )}

          <Button size="sm" variant="ghost" className="ml-auto" onClick={skip}>
            Пропустить
          </Button>
        </div>
      </div>
    </div>
  );
}
