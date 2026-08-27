'use client';

import { Pause, Play } from 'lucide-react';
import { useEffect, useState } from 'react';

import { Button } from '@/components/ui/button';

/**
 * Таймер перерыва.
 *
 * Запускает его человек — система только предлагает. Разница не косметическая:
 * приложение, которое само решает, когда вам отдыхать, начинает управлять
 * занятием вместо того, чтобы его обслуживать, а сигнал усталости здесь пока
 * не валидирован ничем, кроме внутрисессионной медианы.
 *
 * Таймер ничего не блокирует: практику можно продолжать, не дожидаясь конца.
 */
export function RestTimer({ seconds, onDone }: { seconds: number; onDone: () => void }) {
  const [left, setLeft] = useState(seconds);
  const [running, setRunning] = useState(true);

  useEffect(() => {
    if (!running) return;
    if (left <= 0) {
      onDone();
      return;
    }
    const timer = setTimeout(() => setLeft((value) => value - 1), 1000);
    return () => clearTimeout(timer);
  }, [left, running, onDone]);

  const minutes = Math.floor(left / 60);
  const rest = left % 60;
  const progress = seconds === 0 ? 0 : 1 - left / seconds;

  return (
    <div className="rounded-card border border-border bg-bg-elevated p-3">
      <div className="flex items-center justify-between text-sm">
        <span className="text-fg-muted">Перерыв</span>
        <span
          className="tabular-nums text-fg"
          role="timer"
          aria-live="off"
          aria-label={`Осталось ${minutes} минут ${rest} секунд`}
        >
          {minutes}:{String(rest).padStart(2, '0')}
        </span>
      </div>

      <div className="mt-2 h-1 overflow-hidden rounded-full bg-bg">
        <div
          className="h-full rounded-full bg-accent transition-[width] duration-1000 ease-linear"
          style={{ width: `${Math.round(progress * 100)}%` }}
        />
      </div>

      <div className="mt-2 flex gap-1.5">
        <Button size="sm" variant="ghost" onClick={() => setRunning(!running)}>
          {running ? <Pause aria-hidden /> : <Play aria-hidden />}
          {running ? 'Пауза' : 'Продолжить'}
        </Button>
        <Button size="sm" variant="ghost" onClick={onDone}>
          Закончить перерыв
        </Button>
      </div>
    </div>
  );
}
