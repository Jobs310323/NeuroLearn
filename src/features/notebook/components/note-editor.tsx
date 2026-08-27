'use client';

import { AlertTriangle, Check, Eye, Loader2, Maximize2, Pen, Pin, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Input, Label } from '@/components/ui/input';
import { renderNoteMarkdown } from '@/lib/notes/markdown';
import { enqueueNoteOp, saveDraft } from '@/lib/offline/note-queue';
import { cn } from '@/lib/utils';
import { NOTE_COLOR_META, NOTE_RELATION_META, NOTE_TYPE_META } from '../lib/note-meta';
import { CapsulePrompt } from './capsule-prompt';
import { NoteActions } from './note-actions';
import type { NoteCapsule } from '@/lib/db/schema/types';
import type { NoteColor, NoteType } from '@/lib/db/schema';

export type EditorNote = {
  id: string;
  type: string;
  title: string | null;
  contentMd: string;
  colorLabel: string;
  tags: string[];
  pinned: boolean;
  version: number;
  nodeId: string | null;
  nodeTitle: string | null;
  confusionFlag: boolean;
  isConflictCopy: boolean;
  resurfaceAt: string | null;
  resurfaceReason: string | null;
  aiProcessedAt: string | null;
  capsule: NoteCapsule | null;
  links: { noteId: string; title: string | null; relation: string; direction: 'out' | 'in' }[];
};

type SaveState =
  | { kind: 'idle' }
  | { kind: 'saving' }
  | { kind: 'saved'; at: number }
  | { kind: 'queued' }
  | { kind: 'conflict'; serverContent: string; serverVersion: number; suggestedTitle: string }
  | { kind: 'error'; message: string };

const AUTOSAVE_MS = 1200;

/**
 * Редактор заметки.
 *
 * Автосохранение с задержкой, а не кнопка «Сохранить»: в тетради пишут
 * короткими заходами, и потерять абзац из-за незамеченной кнопки — худшее,
 * что здесь может случиться.
 *
 * Правка всегда уходит с номером версии. Ответ 409 не откатывает экран и не
 * подменяет текст серверным: обе версии показываются рядом, решение за
 * человеком. Без сети правка ложится в офлайн-очередь и в локальный
 * черновик — из списка заметка не исчезает.
 */
export function NoteEditor({
  note,
  onSaved,
  onDeleted,
  paperMode,
  onTogglePaper,
}: {
  note: EditorNote;
  onSaved: (patch: { version: number }) => void;
  onDeleted: () => void;
  paperMode: boolean;
  onTogglePaper: () => void;
}) {
  const [title, setTitle] = useState(note.title ?? '');
  const [content, setContent] = useState(note.contentMd);
  const [type, setType] = useState(note.type);
  const [color, setColor] = useState(note.colorLabel);
  const [tagsInput, setTagsInput] = useState(note.tags.join(', '));
  const [pinned, setPinned] = useState(note.pinned);
  const [version, setVersion] = useState(note.version);
  const [state, setState] = useState<SaveState>({ kind: 'idle' });
  const [preview, setPreview] = useState(false);
  const [focusMode, setFocusMode] = useState(false);

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dirtyRef = useRef(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Смена заметки — полный сброс формы: иначе текст предыдущей заметки
  // уезжает в следующую вместе с автосохранением.
  useEffect(() => {
    setTitle(note.title ?? '');
    setContent(note.contentMd);
    setType(note.type);
    setColor(note.colorLabel);
    setTagsInput(note.tags.join(', '));
    setPinned(note.pinned);
    setVersion(note.version);
    setState({ kind: 'idle' });
    setPreview(false);
    dirtyRef.current = false;
  }, [note]);

  const buildBody = useCallback(
    () => ({
      title: title.trim() ? title.trim() : null,
      contentMd: content,
      type,
      colorLabel: color,
      tags: tagsInput
        .split(',')
        .map((tag) => tag.trim())
        .filter(Boolean)
        .slice(0, 20),
      pinned,
    }),
    [title, content, type, color, tagsInput, pinned],
  );

  const save = useCallback(async () => {
    if (!dirtyRef.current) return;
    const body = buildBody();
    setState({ kind: 'saving' });

    try {
      const res = await fetch(`/api/notes/${note.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...body, version }),
      });

      if (res.status === 409) {
        const payload = await res.json();
        setState({
          kind: 'conflict',
          serverContent: payload.serverNote?.contentMd ?? '',
          serverVersion: payload.serverVersion ?? version,
          suggestedTitle:
            payload.suggestedConflictTitle ?? `${title || 'Без названия'} (конфликтная копия)`,
        });
        return;
      }

      if (!res.ok) throw new Error('Сервер отклонил сохранение');

      const payload = await res.json();
      dirtyRef.current = false;
      setVersion(payload.version);
      setState({ kind: 'saved', at: Date.now() });
      onSaved({ version: payload.version });
    } catch {
      // Сети нет — правка не пропадает: очередь довезёт её, черновик
      // держит текст на устройстве до подтверждения сервером.
      await enqueueNoteOp({ kind: 'update', noteId: note.id, baseVersion: version, body });
      await saveDraft({
        id: note.id,
        title: body.title,
        contentMd: body.contentMd,
        type: body.type,
        nodeId: note.nodeId,
        updatedAt: new Date().toISOString(),
        pending: true,
      });
      dirtyRef.current = false;
      setState({ kind: 'queued' });
    }
  }, [buildBody, note.id, note.nodeId, onSaved, title, version]);

  function markDirty() {
    dirtyRef.current = true;
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => void save(), AUTOSAVE_MS);
  }

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  /** Сохранить конфликтную копию рядом — оригинал на сервере не трогаем. */
  async function keepBoth() {
    if (state.kind !== 'conflict') return;
    const body = buildBody();
    setState({ kind: 'saving' });
    try {
      const res = await fetch('/api/notes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...body,
          id: crypto.randomUUID(),
          title: state.suggestedTitle,
          nodeId: note.nodeId,
          conflictOfNoteId: note.id,
        }),
      });
      if (!res.ok) throw new Error('Не удалось сохранить копию');
      dirtyRef.current = false;
      setState({ kind: 'saved', at: Date.now() });
      onSaved({ version: state.serverVersion });
    } catch (error) {
      setState({ kind: 'error', message: error instanceof Error ? error.message : 'Ошибка' });
    }
  }

  async function remove() {
    if (!window.confirm('Удалить заметку? Действие необратимо.')) return;
    const res = await fetch(`/api/notes/${note.id}`, { method: 'DELETE' });
    if (res.ok) onDeleted();
  }

  return (
    <section
      className={cn(
        'flex min-h-0 flex-1 flex-col gap-3 rounded-card border p-4',
        // «Бумажный режим» — единственное светлое место в приложении.
        // Не тема продукта, а свойство тетради: длинный текст на светлом
        // читается иначе, и выбор здесь принадлежит человеку.
        paperMode ? 'note-paper' : 'border-border bg-bg-elevated',
        focusMode && 'note-focus',
      )}
    >
      <div className="flex flex-wrap items-center gap-2">
        <Label className="sr-only" htmlFor="note-title">
          Заголовок заметки
        </Label>
        <Input
          id="note-title"
          value={title}
          placeholder="Заголовок"
          maxLength={200}
          onChange={(e) => {
            setTitle(e.target.value);
            markDirty();
          }}
          className="h-9 min-w-40 flex-1 border-0 bg-transparent px-0 text-base font-medium"
        />

        <Button
          size="sm"
          variant="ghost"
          aria-pressed={pinned}
          aria-label={pinned ? 'Открепить заметку' : 'Закрепить заметку'}
          onClick={() => {
            setPinned(!pinned);
            markDirty();
          }}
        >
          <Pin aria-hidden className={pinned ? 'text-accent' : undefined} />
        </Button>
        <Button
          size="sm"
          variant="ghost"
          aria-pressed={preview}
          onClick={() => setPreview(!preview)}
        >
          {preview ? <Pen aria-hidden /> : <Eye aria-hidden />}
          {preview ? 'Править' : 'Читать'}
        </Button>
        <Button size="sm" variant="ghost" aria-pressed={paperMode} onClick={onTogglePaper}>
          Бумага
        </Button>
        <Button
          size="sm"
          variant="ghost"
          aria-pressed={focusMode}
          onClick={() => {
            setFocusMode(!focusMode);
            textareaRef.current?.focus();
          }}
        >
          <Maximize2 aria-hidden />
          Фокус
        </Button>
        <Button size="sm" variant="ghost" aria-label="Удалить заметку" onClick={() => void remove()}>
          <Trash2 aria-hidden />
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-2 text-xs">
        <Label className="sr-only" htmlFor="note-type">
          Тип заметки
        </Label>
        <select
          id="note-type"
          value={type}
          onChange={(e) => {
            setType(e.target.value);
            markDirty();
          }}
          className="h-7 rounded-md border border-border bg-bg px-2 text-xs text-fg"
        >
          {Object.entries(NOTE_TYPE_META).map(([value, meta]) => (
            <option key={value} value={value}>
              {meta.label}
            </option>
          ))}
        </select>

        <Label className="sr-only" htmlFor="note-color">
          Цветовая метка
        </Label>
        <select
          id="note-color"
          value={color}
          onChange={(e) => {
            setColor(e.target.value);
            markDirty();
          }}
          className="h-7 rounded-md border border-border bg-bg px-2 text-xs text-fg"
        >
          {Object.entries(NOTE_COLOR_META).map(([value, meta]) => (
            <option key={value} value={value}>
              {meta.label}
            </option>
          ))}
        </select>

        <Label className="sr-only" htmlFor="note-tags">
          Теги через запятую
        </Label>
        <Input
          id="note-tags"
          value={tagsInput}
          placeholder="теги через запятую"
          onChange={(e) => {
            setTagsInput(e.target.value);
            markDirty();
          }}
          className="h-7 max-w-64 flex-1 text-xs"
        />

        <SaveIndicator state={state} />
      </div>

      {note.nodeTitle || note.isConflictCopy || note.resurfaceReason ? (
        <div className="flex flex-wrap gap-2 text-[11px] text-fg-subtle">
          {note.nodeTitle ? <span>Якорь: {note.nodeTitle}</span> : null}
          {note.confusionFlag ? <span>Помечено «не понял»</span> : null}
          {note.isConflictCopy ? (
            <span className="text-[var(--color-status-has-gaps)]">Конфликтная копия</span>
          ) : null}
          {note.resurfaceReason ? <span>Вернулась: {note.resurfaceReason}</span> : null}
          {note.aiProcessedAt ? (
            <span title="AI обрабатывал текст этой заметки">
              AI: {new Date(note.aiProcessedAt).toLocaleDateString('ru-RU')}
            </span>
          ) : null}
        </div>
      ) : null}

      {/* Вернувшаяся капсула спрашивает первой: её ответ — точка данных
          калибровки, и пропущенный вопрос эту точку теряет навсегда. */}
      {note.capsule && !note.capsule.answeredAt && note.resurfaceAt ? (
        <CapsulePrompt noteId={note.id} capsule={note.capsule} onAnswered={() => onSaved({ version })} />
      ) : null}

      {state.kind === 'conflict' ? (
        <div className="rounded-md border border-[var(--color-status-has-gaps)] bg-bg p-3 text-xs">
          <p className="flex items-center gap-1.5 font-medium text-[var(--color-status-has-gaps)]">
            <AlertTriangle className="size-3.5" aria-hidden />
            Заметку изменили в другом месте
          </p>
          <p className="mt-1 text-fg-muted">
            Ваш текст на экране не тронут. Ниже — версия с сервера. Ничего не перезаписывается
            автоматически: сохраните обе и сведите вручную.
          </p>
          <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap rounded border border-border p-2 text-[11px] text-fg-muted">
            {state.serverContent || '(пусто)'}
          </pre>
          <Button size="sm" className="mt-2" onClick={() => void keepBoth()}>
            Сохранить обе версии
          </Button>
        </div>
      ) : null}

      {preview ? (
        <div
          className="note-prose min-h-40 flex-1 overflow-auto text-sm"
          // Безопасно: `renderNoteMarkdown` экранирует весь ввод ПЕРЕД
          // наложением разметки (см. lib/notes/markdown.ts).
          dangerouslySetInnerHTML={{ __html: renderNoteMarkdown(content) }}
        />
      ) : (
        <>
          <Label className="sr-only" htmlFor="note-content">
            Текст заметки
          </Label>
          <textarea
            id="note-content"
            ref={textareaRef}
            value={content}
            placeholder="Мысль, конспект, вопрос…"
            onChange={(e) => {
              setContent(e.target.value);
              markDirty();
            }}
            onBlur={() => void save()}
            className={cn(
              'min-h-40 flex-1 resize-none rounded-md border border-transparent bg-transparent p-2 text-sm leading-relaxed outline-none',
              'font-[var(--font-serif)] focus-visible:border-border',
            )}
          />
        </>
      )}

      <NoteActions note={note} onChanged={() => onSaved({ version })} />

      {note.links.length > 0 ? (
        <div className="border-t border-border pt-2 text-xs text-fg-muted">
          <p className="mb-1 font-medium text-fg">Связи</p>
          <ul className="flex flex-col gap-1">
            {note.links.map((link) => (
              <li key={`${link.direction}:${link.noteId}:${link.relation}`}>
                {link.direction === 'in' ? '← ' : '→ '}
                {NOTE_RELATION_META[link.relation as keyof typeof NOTE_RELATION_META]?.label ??
                  link.relation}
                : {link.title ?? 'Без названия'}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}

function SaveIndicator({ state }: { state: SaveState }) {
  if (state.kind === 'saving') {
    return (
      <span className="flex items-center gap-1 text-fg-subtle" aria-live="polite">
        <Loader2 className="size-3 animate-spin" aria-hidden />
        сохраняю
      </span>
    );
  }
  if (state.kind === 'saved') {
    return (
      <span className="flex items-center gap-1 text-fg-subtle" aria-live="polite">
        <Check className="size-3" aria-hidden />
        сохранено
      </span>
    );
  }
  if (state.kind === 'queued') {
    return (
      <span className="text-[var(--color-status-in-progress)]" aria-live="polite">
        без сети — в очереди, текст не потерян
      </span>
    );
  }
  if (state.kind === 'error') {
    return (
      <span className="text-[var(--color-status-has-gaps)]" aria-live="polite">
        {state.message}
      </span>
    );
  }
  return null;
}

export type { NoteType, NoteColor };
