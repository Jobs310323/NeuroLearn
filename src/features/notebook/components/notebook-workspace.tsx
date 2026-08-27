'use client';

import { Download, Plus, Search } from 'lucide-react';
import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Input, Label } from '@/components/ui/input';
import { SkeletonList } from '@/components/ui/skeleton';
import type { NoteListItem } from '@/lib/db/queries/notes';
import { enqueueNoteOp, saveDraft } from '@/lib/offline/note-queue';
import { flushPendingNotes } from '@/lib/offline/note-sync';
import { cn } from '@/lib/utils';

import { NOTE_COLOR_META, NOTE_TYPE_META, noteColorToken, noteTypeLabel } from '../lib/note-meta';
import { NoteEditor, type EditorNote } from './note-editor';

type Filters = {
  q: string;
  type: string;
  color: string;
  confusion: boolean;
  due: boolean;
  archived: boolean;
};

const EMPTY_FILTERS: Filters = {
  q: '',
  type: '',
  color: '',
  confusion: false,
  due: false,
  archived: false,
};

/**
 * Рабочая тетрадь: список слева, редактор справа.
 *
 * Поиск и фильтры — серверные и детерминированные (полнотекстовый индекс,
 * без модели). Это не временное решение до появления семантики: тетрадь
 * обязана полностью работать при мёртвых провайдерах, а семантический поиск
 * приходит отдельным слоем поверх и подменять этот не может.
 */
export function NotebookWorkspace({
  initialNoteId,
  initialNodeId,
  capture,
}: {
  initialNoteId?: string;
  initialNodeId?: string;
  /** Захват из практики: заметка создаётся сразу с готовыми якорями. */
  capture?: {
    nodeId: string | null;
    assessmentId: string | null;
    sessionId: string | null;
    confusion: boolean;
  };
}) {
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [items, setItems] = useState<NoteListItem[] | null>(null);
  const [total, setTotal] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(initialNoteId ?? null);
  const [selected, setSelected] = useState<EditorNote | null>(null);
  const [paperMode, setPaperMode] = useState(false);
  const [syncNote, setSyncNote] = useState<string | null>(null);
  const captureDoneRef = useRef(false);

  const load = useCallback(async () => {
    const params = new URLSearchParams();
    if (filters.q) params.set('q', filters.q);
    if (filters.type) params.set('type', filters.type);
    if (filters.color) params.set('color', filters.color);
    if (filters.confusion) params.set('confusion', 'true');
    if (filters.due) params.set('due', 'true');
    if (initialNodeId) params.set('nodeId', initialNodeId);
    params.set('archived', String(filters.archived));

    const res = await fetch(`/api/notes?${params}`);
    if (!res.ok) {
      setItems([]);
      return;
    }
    const body = await res.json();
    setItems(body.items);
    setTotal(body.total);
  }, [filters, initialNodeId]);

  useEffect(() => {
    // Поиск с задержкой: каждый символ в запрос не превращаем.
    const timer = setTimeout(() => void load(), filters.q ? 300 : 0);
    return () => clearTimeout(timer);
  }, [load, filters.q]);

  useEffect(() => {
    if (!selectedId) {
      setSelected(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      const res = await fetch(`/api/notes/${selectedId}`);
      if (!res.ok || cancelled) return;
      setSelected(await res.json());
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedId]);

  // Накопленное офлайн уезжает при возвращении сети — и только тогда.
  useEffect(() => {
    const onOnline = () => {
      void flushPendingNotes().then((result) => {
        if (result.synced > 0 || result.conflicts > 0) {
          setSyncNote(
            result.conflicts > 0
              ? `Отправлено: ${result.synced}. Конфликтов: ${result.conflicts} — обе версии сохранены.`
              : `Отправлено заметок: ${result.synced}.`,
          );
          void load();
        }
      });
    };
    window.addEventListener('online', onOnline);
    return () => window.removeEventListener('online', onOnline);
  }, [load]);

  /**
   * Захват из практики (`?capture=1`). Заметка создаётся немедленно и с уже
   * проставленными якорями — узел, задание, сессия. Один шаг, потому что
   * ровно ради этого шага механизм и существует: непонимание живёт минуты.
   */
  useEffect(() => {
    if (!capture || captureDoneRef.current) return;
    captureDoneRef.current = true;

    void (async () => {
      const id = crypto.randomUUID();
      const body = {
        id,
        type: capture.confusion ? ('question' as const) : ('capture' as const),
        contentMd: '',
        nodeId: capture.nodeId,
        assessmentId: capture.assessmentId,
        sessionId: capture.sessionId,
        confusionFlag: capture.confusion,
        colorLabel: capture.confusion ? ('question' as const) : ('neutral' as const),
      };
      try {
        const res = await fetch('/api/notes', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        if (!res.ok) throw new Error('offline');
      } catch {
        await enqueueNoteOp({ kind: 'create', noteId: id, body });
        await saveDraft({
          id,
          title: null,
          contentMd: '',
          type: body.type,
          nodeId: capture.nodeId,
          updatedAt: new Date().toISOString(),
          pending: true,
        });
      }
      setSelectedId(id);
      await load();
    })();
  }, [capture, load]);

  async function createNote() {
    const id = crypto.randomUUID();
    const body = {
      id,
      type: 'capture' as const,
      title: null,
      contentMd: '',
      nodeId: initialNodeId ?? null,
    };
    try {
      const res = await fetch('/api/notes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error('offline');
      setSelectedId(id);
      await load();
    } catch {
      await enqueueNoteOp({ kind: 'create', noteId: id, body });
      await saveDraft({
        id,
        title: null,
        contentMd: '',
        type: 'capture',
        nodeId: initialNodeId ?? null,
        updatedAt: new Date().toISOString(),
        pending: true,
      });
      setSyncNote('Без сети: заметка создана локально и уйдёт на сервер при подключении.');
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 lg:flex-row">
      <div className="flex min-h-0 w-full flex-col gap-3 lg:max-w-sm">
        <div className="flex items-center gap-2">
          <Button size="sm" onClick={() => void createNote()}>
            <Plus aria-hidden />
            Записать
          </Button>
          <Button size="sm" variant="secondary" asChild>
            <a href="/api/notes/export" download>
              <Download aria-hidden />
              Выгрузить
            </a>
          </Button>
          <Button size="sm" variant="ghost" asChild>
            <Link href="/notes/registry">Реестр</Link>
          </Button>
        </div>

        <div className="relative">
          <Search
            className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-fg-subtle"
            aria-hidden
          />
          <Label className="sr-only" htmlFor="note-search">
            Поиск по тетради
          </Label>
          <Input
            id="note-search"
            value={filters.q}
            placeholder="Поиск по заметкам"
            onChange={(e) => setFilters({ ...filters, q: e.target.value })}
            className="pl-8"
          />
        </div>

        <div className="flex flex-wrap gap-1.5 text-xs">
          <FilterChip
            active={filters.due}
            onClick={() => setFilters({ ...filters, due: !filters.due })}
          >
            Пора перечитать
          </FilterChip>
          <FilterChip
            active={filters.confusion}
            onClick={() => setFilters({ ...filters, confusion: !filters.confusion })}
          >
            Реестр непонимания
          </FilterChip>
          <FilterChip
            active={filters.archived}
            onClick={() => setFilters({ ...filters, archived: !filters.archived })}
          >
            Архив
          </FilterChip>
        </div>

        <div className="flex gap-2">
          <Label className="sr-only" htmlFor="filter-type">
            Тип заметки
          </Label>
          <select
            id="filter-type"
            value={filters.type}
            onChange={(e) => setFilters({ ...filters, type: e.target.value })}
            className="h-8 flex-1 rounded-md border border-border bg-bg px-2 text-xs text-fg"
          >
            <option value="">Все типы</option>
            {Object.entries(NOTE_TYPE_META).map(([value, meta]) => (
              <option key={value} value={value}>
                {meta.label}
              </option>
            ))}
          </select>

          <Label className="sr-only" htmlFor="filter-color">
            Цветовая метка
          </Label>
          <select
            id="filter-color"
            value={filters.color}
            onChange={(e) => setFilters({ ...filters, color: e.target.value })}
            className="h-8 flex-1 rounded-md border border-border bg-bg px-2 text-xs text-fg"
          >
            <option value="">Все метки</option>
            {Object.entries(NOTE_COLOR_META).map(([value, meta]) => (
              <option key={value} value={value}>
                {meta.label}
              </option>
            ))}
          </select>
        </div>

        {syncNote ? (
          <p className="text-xs text-[var(--color-status-in-progress)]" aria-live="polite">
            {syncNote}
          </p>
        ) : null}

        <div className="min-h-0 flex-1 overflow-auto">
          {items === null ? (
            // Скелетон вместо спиннера: он показывает форму будущего списка,
            // и переход к данным не сдвигает раскладку.
            <SkeletonList count={4} label="Загружаю тетрадь…" />
          ) : items.length === 0 ? (
            <p className="p-2 text-sm text-fg-muted">
              Пока пусто. Первая заметка обычно приходит прямо из практики — там есть кнопка
              «Записать мысль».
            </p>
          ) : (
            <ul className="cascade flex flex-col gap-1.5">
              {items.map((item, index) => (
                <li key={item.id} style={{ '--index': Math.min(index, 8) } as React.CSSProperties}>
                  <button
                    type="button"
                    onClick={() => setSelectedId(item.id)}
                    aria-current={item.id === selectedId ? 'true' : undefined}
                    className={cn(
                      'w-full rounded-md border p-2.5 text-left transition-colors',
                      item.id === selectedId
                        ? 'border-accent bg-bg-hover'
                        : 'border-border hover:bg-bg-hover',
                    )}
                  >
                    <span className="flex items-center gap-1.5">
                      <span
                        aria-hidden
                        className="size-2 shrink-0 rounded-full"
                        style={{ backgroundColor: noteColorToken(item.colorLabel) }}
                      />
                      <span className="min-w-0 flex-1 truncate text-sm text-fg">
                        {item.title ?? 'Без названия'}
                      </span>
                      {item.pinned ? (
                        <span className="text-[10px] text-accent">закреплено</span>
                      ) : null}
                    </span>
                    <span className="mt-1 block truncate text-xs text-fg-subtle">
                      {item.excerpt || 'пусто'}
                    </span>
                    <span className="mt-1 flex flex-wrap gap-1.5 text-[10px] text-fg-subtle">
                      <span>{noteTypeLabel(item.type)}</span>
                      {item.nodeTitle ? <span>· {item.nodeTitle}</span> : null}
                      {item.resurfaceAt ? <span>· пора перечитать</span> : null}
                      {item.isConflictCopy ? (
                        <span className="text-[var(--color-status-has-gaps)]">· конфликт</span>
                      ) : null}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <p className="text-[11px] text-fg-subtle">
          {/* Число заметок — не достижение, а ориентир в списке: счётчик стоит
              рядом с фильтрами и нигде больше не показывается. */}
          Найдено: {total}
        </p>
      </div>

      {selected ? (
        <NoteEditor
          note={selected}
          paperMode={paperMode}
          onTogglePaper={() => setPaperMode(!paperMode)}
          onSaved={() => void load()}
          onDeleted={() => {
            setSelectedId(null);
            void load();
          }}
        />
      ) : (
        <section className="flex flex-1 items-center justify-center rounded-card border border-border bg-bg-elevated p-8 text-sm text-fg-muted">
          Выберите заметку слева или запишите новую.
        </section>
      )}
    </div>
  );
}

function FilterChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'rounded-full border px-2.5 py-1 transition-colors',
        active
          ? 'border-accent bg-accent/10 text-fg'
          : 'border-border text-fg-muted hover:bg-bg-hover',
      )}
    >
      {children}
    </button>
  );
}
