'use client';

import { CalendarClock } from 'lucide-react';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { Input, Label } from '@/components/ui/input';
import type { NoteCapsule } from '@/lib/db/schema/types';

/**
 * Вернувшаяся капсула времени: «сбылось ли?».
 *
 * Оценивает только автор предсказания. Модель здесь не участвует не из
 * экономии, а потому что она не знает его контекста: «частично сбылось» —
 * это суждение о собственной жизни, и переданное модели оно превратилось бы
 * из данных о калибровке в её догадку.
 *
 * Ответ показывает разрыв сразу, без нравоучения: число, а не оценка
 * человека.
 */
export function CapsulePrompt({
  noteId,
  capsule,
  onAnswered,
}: {
  noteId: string;
  capsule: NoteCapsule;
  onAnswered: () => void;
}) {
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ gap: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function answer(outcome: 'happened' | 'partly' | 'not_happened') {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/notes/${noteId}/capsule`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind: 'answer', outcome, outcomeNote: note.trim() || null }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error?.message ?? 'Не удалось записать ответ');
      setResult({ gap: body.calibration.gap });
      onAnswered();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Сеть недоступна');
    } finally {
      setBusy(false);
    }
  }

  if (result) {
    const overconfident = result.gap > 0.15;
    const underconfident = result.gap < -0.15;

    return (
      <div className="rounded-md border border-border bg-bg p-3 text-xs text-fg-muted">
        <p className="text-fg">Записано.</p>
        <p className="mt-1">
          {overconfident
            ? 'Уверенность была выше того, что вышло. Это то же самое переоценивание себя, что и в практике, только на горизонте месяцев.'
            : underconfident
              ? 'Вышло лучше, чем вы ожидали. Недооценка себя тоже стоит внимания: она заставляет перепроверять то, что уже знаете.'
              : 'Предсказание и исход совпали. Калибровка на этом горизонте хорошая.'}
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-md border border-[var(--color-status-needs-review)] bg-bg p-3 text-xs">
      <p className="flex items-center gap-1.5 font-medium text-[var(--color-status-needs-review)]">
        <CalendarClock className="size-3.5" aria-hidden />
        Капсула времени вернулась
      </p>

      <p className="mt-2 text-fg">«{capsule.prediction}»</p>
      <p className="mt-1 text-fg-subtle">
        Тогда вы оценили вероятность на {capsule.confidence} из 5. Сбылось?
      </p>

      <Label className="sr-only" htmlFor={`capsule-note-${noteId}`}>
        Что вышло на самом деле
      </Label>
      <Input
        id={`capsule-note-${noteId}`}
        value={note}
        placeholder="Что вышло на самом деле (необязательно)"
        onChange={(e) => setNote(e.target.value)}
        className="mt-2 h-8 text-xs"
      />

      {error ? <p className="mt-1 text-[var(--color-status-has-gaps)]">{error}</p> : null}

      <div className="mt-2 flex flex-wrap gap-1.5">
        <Button size="sm" disabled={busy} onClick={() => void answer('happened')}>
          Сбылось
        </Button>
        <Button size="sm" variant="secondary" disabled={busy} onClick={() => void answer('partly')}>
          Частично
        </Button>
        <Button
          size="sm"
          variant="secondary"
          disabled={busy}
          onClick={() => void answer('not_happened')}
        >
          Не сбылось
        </Button>
      </div>
    </div>
  );
}
