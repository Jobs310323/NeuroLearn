'use client';

import { CalendarClock, FlaskConical, Link2, MessageCircleQuestion } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { Input, Label, Textarea } from '@/components/ui/input';
import { NOTE_RELATION_META } from '../lib/note-meta';
import type { EditorNote } from './note-editor';

/**
 * Пайплайны «мысль → действие» на самой заметке.
 *
 * Кнопки показываются по типу заметки: идее предлагается проверка, вопросу —
 * тьютор. Показывать все действия всегда значило бы предлагать «проверить
 * экспериментом» цитату из книги — шум, который перестают читать.
 *
 * Ни одно действие не выполняется молча: эксперимент создаётся черновиком,
 * диалог — пустым с вопросом человека первой репликой. Ничто из этого не
 * меняет расписание и подбор практики само по себе.
 */
export function NoteActions({
  note,
  onChanged,
}: {
  note: EditorNote;
  onChanged: () => void;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [capsuleOpen, setCapsuleOpen] = useState(false);

  async function runPipeline(kind: 'to_experiment' | 'to_tutor') {
    setBusy(kind);
    setMessage(null);
    try {
      const res = await fetch(`/api/notes/${note.id}/pipeline`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error?.message ?? 'Не получилось');

      if (kind === 'to_experiment') {
        setMessage(
          body.existing
            ? 'Эксперимент по этой идее уже есть — открываю его.'
            : 'Создан черновик эксперимента. Запускать его — ваше решение: запуск меняет подбор практики на неделю вперёд.',
        );
        router.push('/analytics');
      } else {
        router.push(`/tutor?conversationId=${body.conversationId}`);
      }
      onChanged();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Сеть недоступна');
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="flex flex-col gap-2 border-t border-border pt-3">
      <div className="flex flex-wrap gap-1.5">
        {note.type === 'idea' ? (
          <Button
            size="sm"
            variant="secondary"
            disabled={busy !== null}
            onClick={() => void runPipeline('to_experiment')}
          >
            <FlaskConical aria-hidden />
            Проверить экспериментом
          </Button>
        ) : null}

        {note.type === 'question' || note.confusionFlag ? (
          <Button
            size="sm"
            variant="secondary"
            disabled={busy !== null}
            onClick={() => void runPipeline('to_tutor')}
          >
            <MessageCircleQuestion aria-hidden />
            Спросить тьютора
          </Button>
        ) : null}

        <Button
          size="sm"
          variant="ghost"
          aria-expanded={capsuleOpen}
          onClick={() => setCapsuleOpen(!capsuleOpen)}
        >
          <CalendarClock aria-hidden />
          Капсула времени
        </Button>

        <NoteLinker noteId={note.id} onLinked={onChanged} />
      </div>

      {capsuleOpen ? <CapsuleForm note={note} onSaved={onChanged} /> : null}

      {message ? (
        <p className="text-xs text-fg-muted" aria-live="polite">
          {message}
        </p>
      ) : null}
    </div>
  );
}

/**
 * Капсула времени: предсказание + уверенность + дата возврата.
 *
 * Уверенность обязательна. Без неё ответ «сбылось / не сбылось» — просто
 * факт, а с ней это точка данных калибровки: ровно та же пара, что
 * (уверенность, правильность) в практике, только на горизонте месяцев.
 */
function CapsuleForm({ note, onSaved }: { note: EditorNote; onSaved: () => void }) {
  const [prediction, setPrediction] = useState('');
  const [confidence, setConfidence] = useState(3);
  const [date, setDate] = useState(defaultCapsuleDate());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/notes/${note.id}/capsule`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          kind: 'schedule',
          prediction: prediction.trim(),
          confidence,
          resurfaceAt: new Date(`${date}T09:00:00`).toISOString(),
        }),
      });
      if (!res.ok) {
        const body = await res.json();
        throw new Error(body.error?.message ?? 'Не удалось назначить капсулу');
      }
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Сеть недоступна');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-2 rounded-md border border-border bg-bg p-3 text-xs">
      <p className="text-fg-muted">
        Заметка вернётся в назначенный день с вопросом «сбылось ли». Ответ станет точкой
        данных калибровки — тем же, чем в практике пара «уверенность и правильность».
      </p>

      <Label htmlFor="capsule-prediction">Что, по-вашему, произойдёт</Label>
      <Textarea
        id="capsule-prediction"
        rows={2}
        value={prediction}
        onChange={(e) => setPrediction(e.target.value)}
        placeholder="К концу месяца я буду решать такие задачи без подсказок"
      />

      <Label htmlFor="capsule-confidence">Насколько уверены: {confidence} из 5</Label>
      <input
        id="capsule-confidence"
        type="range"
        min={1}
        max={5}
        value={confidence}
        onChange={(e) => setConfidence(Number(e.target.value))}
        className="accent-[var(--color-accent)]"
      />

      <Label htmlFor="capsule-date">Когда вернуть</Label>
      <Input
        id="capsule-date"
        type="date"
        value={date}
        min={tomorrow()}
        onChange={(e) => setDate(e.target.value)}
        className="h-8"
      />

      {error ? <p className="text-[var(--color-status-has-gaps)]">{error}</p> : null}

      <Button
        size="sm"
        className="self-start"
        disabled={busy || prediction.trim().length === 0}
        onClick={() => void save()}
      >
        Назначить капсулу
      </Button>
    </div>
  );
}

/** Месяц вперёд: типичный горизонт, на котором предсказание ещё проверяемо. */
function defaultCapsuleDate(): string {
  const date = new Date();
  date.setMonth(date.getMonth() + 1);
  return date.toISOString().slice(0, 10);
}

function tomorrow(): string {
  return new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
}

/** Связывание двух заметок типизированным отношением. */
function NoteLinker({ noteId, onLinked }: { noteId: string; onLinked: () => void }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<{ id: string; label: string }[]>([]);
  const [relation, setRelation] = useState<keyof typeof NOTE_RELATION_META>('supports');

  async function search(value: string) {
    setQuery(value);
    if (value.trim().length < 2) {
      setHits([]);
      return;
    }
    const res = await fetch(`/api/search?q=${encodeURIComponent(value)}`);
    if (!res.ok) return;
    const body = await res.json();
    setHits(
      (body.hits as { id: string; kind: string; label: string }[])
        .filter((hit) => hit.kind === 'note' && hit.id !== noteId)
        .map((hit) => ({ id: hit.id, label: hit.label })),
    );
  }

  async function link(toNoteId: string) {
    await fetch(`/api/notes/${noteId}/links`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ toNoteId, relation }),
    });
    setOpen(false);
    setQuery('');
    setHits([]);
    onLinked();
  }

  if (!open) {
    return (
      <Button size="sm" variant="ghost" onClick={() => setOpen(true)}>
        <Link2 aria-hidden />
        Связать
      </Button>
    );
  }

  return (
    <div className="flex w-full flex-col gap-2 rounded-md border border-border bg-bg p-2.5 text-xs">
      <div className="flex gap-2">
        <Label className="sr-only" htmlFor="link-relation">
          Тип связи
        </Label>
        <select
          id="link-relation"
          value={relation}
          onChange={(e) => setRelation(e.target.value as keyof typeof NOTE_RELATION_META)}
          className="h-8 rounded-md border border-border bg-bg px-2 text-xs text-fg"
        >
          {Object.entries(NOTE_RELATION_META).map(([value, meta]) => (
            <option key={value} value={value}>
              {meta.label}
            </option>
          ))}
        </select>

        <Label className="sr-only" htmlFor="link-search">
          Поиск заметки для связи
        </Label>
        <Input
          id="link-search"
          value={query}
          placeholder="Какую заметку связать"
          onChange={(e) => void search(e.target.value)}
          className="h-8 flex-1"
        />

        <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>
          Отмена
        </Button>
      </div>

      {hits.length > 0 ? (
        <ul className="flex flex-col gap-1">
          {hits.map((hit) => (
            <li key={hit.id}>
              <button
                type="button"
                onClick={() => void link(hit.id)}
                className="w-full truncate rounded px-2 py-1 text-left text-fg-muted hover:bg-bg-hover hover:text-fg"
              >
                {hit.label}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
