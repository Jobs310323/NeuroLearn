'use client';

import {
  BarChart3,
  BookOpen,
  FlaskConical,
  LayoutGrid,
  Loader2,
  Pencil,
  Play,
  Route as RouteIcon,
  Search,
  Settings,
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';

import { enqueueNoteOp, saveDraft } from '@/lib/offline/note-queue';
import { cn } from '@/lib/utils';

/**
 * Командная палитра (⌘K / Ctrl+K).
 *
 * Главное здесь не навигация, а захват: «записать мысль» должно занимать один
 * жест из любого места приложения. Мысль, ради которой надо дойти до раздела
 * «Тетрадь», не записывается — она забывается по дороге.
 *
 * Поиск идёт по заметкам и узлам через обычный API, детерминированно.
 * Клавиатура работает целиком: стрелки, Enter, Esc; фокус запирается внутри
 * диалога, а при закрытии возвращается туда, откуда пришёл.
 */

type Command = {
  id: string;
  label: string;
  hint?: string;
  icon: typeof Search;
  run: () => void | Promise<void>;
};

type SearchHit = { id: string; kind: 'note' | 'node'; label: string; hint: string; href: string };

export function CommandPalette() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [active, setActive] = useState(0);
  const [busy, setBusy] = useState(false);

  const inputRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);

  const close = useCallback(() => {
    setOpen(false);
    setQuery('');
    setHits([]);
    setActive(0);
    restoreFocusRef.current?.focus();
  }, []);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        restoreFocusRef.current = document.activeElement as HTMLElement | null;
        setOpen((value) => !value);
      }
      if (event.key === 'Escape') setOpen(false);
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  /**
   * Ловушка фокуса. Без неё Tab из палитры уводит на страницу под ней, и
   * человек на клавиатуре оказывается «за» модальным окном, которое всё ещё
   * закрывает экран, — состояние, из которого без мыши не выбраться.
   */
  useEffect(() => {
    if (!open) return;

    function onTab(event: KeyboardEvent) {
      if (event.key !== 'Tab' || !dialogRef.current) return;

      const focusable = dialogRef.current.querySelectorAll<HTMLElement>(
        'button, input, [href], select, textarea, [tabindex]:not([tabindex="-1"])',
      );
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (!first || !last) return;

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener('keydown', onTab);
    return () => document.removeEventListener('keydown', onTab);
  }, [open]);

  // Поиск с задержкой: палитра открывается ради одного нажатия, и запрос на
  // каждый символ ради этого не нужен.
  useEffect(() => {
    if (!open || query.trim().length < 2) {
      setHits([]);
      return;
    }
    const timer = setTimeout(async () => {
      const res = await fetch(`/api/search?q=${encodeURIComponent(query)}`);
      if (!res.ok) return;
      const body = await res.json();
      setHits(body.hits ?? []);
    }, 250);
    return () => clearTimeout(timer);
  }, [open, query]);

  /** Захват из палитры: заметка создаётся сразу и открывается на правку. */
  const capture = useCallback(async () => {
    setBusy(true);
    const id = crypto.randomUUID();
    const body = { id, type: 'capture' as const, contentMd: query.trim() };
    try {
      const res = await fetch('/api/notes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error('offline');
    } catch {
      // Без сети мысль всё равно записана: очередь довезёт её позже.
      await enqueueNoteOp({ kind: 'create', noteId: id, body });
      await saveDraft({
        id,
        title: null,
        contentMd: body.contentMd,
        type: 'capture',
        nodeId: null,
        updatedAt: new Date().toISOString(),
        pending: true,
      });
    } finally {
      setBusy(false);
      close();
      router.push(`/notes?note=${id}`);
    }
  }, [close, query, router]);

  const commands: Command[] = [
    {
      id: 'capture',
      label: query.trim() ? `Записать: «${query.trim()}»` : 'Записать мысль',
      hint: 'Заметка создаётся сразу, даже без сети',
      icon: Pencil,
      run: capture,
    },
    {
      id: 'practice',
      label: 'Начать сессию практики',
      icon: Play,
      run: () => router.push('/review'),
    },
    {
      id: 'map',
      label: 'Перейти на карту знаний',
      hint: 'Там же кнопка «Упорядочить»',
      icon: LayoutGrid,
      run: () => router.push('/paths'),
    },
    {
      id: 'notes',
      label: 'Открыть тетрадь',
      icon: BookOpen,
      run: () => router.push('/notes'),
    },
    {
      id: 'experiment',
      label: 'Создать эксперимент',
      icon: FlaskConical,
      run: () => router.push('/analytics'),
    },
    {
      id: 'paths',
      label: 'Пути обучения',
      icon: RouteIcon,
      run: () => router.push('/paths'),
    },
    {
      id: 'analytics',
      label: 'Аналитика',
      icon: BarChart3,
      run: () => router.push('/analytics'),
    },
    { id: 'settings', label: 'Настройки', icon: Settings, run: () => router.push('/settings') },
  ];

  const filtered = query.trim()
    ? commands.filter(
        (command) =>
          command.id === 'capture' ||
          command.label.toLowerCase().includes(query.trim().toLowerCase()),
      )
    : commands;

  const rows: { key: string; label: string; hint?: string; icon: typeof Search; run: () => void }[] = [
    ...filtered.map((command) => ({
      key: command.id,
      label: command.label,
      hint: command.hint,
      icon: command.icon,
      run: () => void command.run(),
    })),
    ...hits.map((hit) => ({
      key: `${hit.kind}:${hit.id}`,
      label: hit.label,
      hint: hit.hint,
      icon: hit.kind === 'note' ? BookOpen : RouteIcon,
      run: () => {
        close();
        router.push(hit.href);
      },
    })),
  ];

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center p-4 pt-[12vh]">
      {/* Подложка — кнопка, а не div с onClick: закрытие по фону обязано
          работать и с клавиатуры, а не только мышью. */}
      <button
        type="button"
        aria-label="Закрыть палитру"
        onClick={close}
        className="absolute inset-0 cursor-default bg-black/50 backdrop-blur-sm"
      />

      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label="Командная палитра"
        className="relative w-full max-w-xl overflow-hidden rounded-card border border-border bg-bg-elevated shadow-2xl"
      >
        <div className="flex items-center gap-2 border-b border-border px-3">
          {busy ? (
            <Loader2 className="size-4 animate-spin text-fg-subtle" aria-hidden />
          ) : (
            <Search className="size-4 text-fg-subtle" aria-hidden />
          )}
          {/* Клавиатура обрабатывается на самом поле: фокус всегда здесь,
              и обработчик на контейнере ловил бы события мимо цели. */}
          <input
            ref={inputRef}
            value={query}
            role="combobox"
            aria-expanded="true"
            aria-controls="command-palette-list"
            aria-activedescendant={rows[active] ? `command-${rows[active].key}` : undefined}
            onChange={(event) => {
              setQuery(event.target.value);
              setActive(0);
            }}
            onKeyDown={(event) => {
              if (event.key === 'ArrowDown') {
                event.preventDefault();
                setActive((index) => Math.min(rows.length - 1, index + 1));
              }
              if (event.key === 'ArrowUp') {
                event.preventDefault();
                setActive((index) => Math.max(0, index - 1));
              }
              if (event.key === 'Enter') {
                event.preventDefault();
                rows[active]?.run();
              }
              if (event.key === 'Escape') close();
            }}
            placeholder="Записать мысль, найти заметку или узел…"
            aria-label="Команда или поиск"
            className="h-11 flex-1 bg-transparent text-sm text-fg outline-none placeholder:text-fg-subtle"
          />
          <kbd className="rounded border border-border px-1.5 py-0.5 text-[10px] text-fg-subtle">
            Esc
          </kbd>
        </div>

        <ul
          id="command-palette-list"
          className="max-h-80 overflow-auto p-1.5"
          role="listbox"
          aria-label="Команды"
        >
          {rows.length === 0 ? (
            <li className="p-3 text-sm text-fg-muted">Ничего не найдено</li>
          ) : (
            rows.map((row, index) => (
              <li key={row.key}>
                <button
                  type="button"
                  id={`command-${row.key}`}
                  role="option"
                  aria-selected={index === active}
                  onMouseEnter={() => setActive(index)}
                  onClick={row.run}
                  className={cn(
                    'flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-sm transition-colors',
                    index === active ? 'bg-bg-hover text-fg' : 'text-fg-muted',
                  )}
                >
                  <row.icon className="size-4 shrink-0" aria-hidden />
                  <span className="min-w-0 flex-1 truncate">{row.label}</span>
                  {row.hint ? (
                    <span className="hidden shrink-0 text-[11px] text-fg-subtle sm:inline">
                      {row.hint}
                    </span>
                  ) : null}
                </button>
              </li>
            ))
          )}
        </ul>
      </div>
    </div>
  );
}
