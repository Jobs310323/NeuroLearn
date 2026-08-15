'use client';

import { Dumbbell, MessageCircle, Sparkles, Trash2, X } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { ScienceHint } from '@/components/science-hint';
import { Button } from '@/components/ui/button';
import { Input, Label, Textarea } from '@/components/ui/input';
import type { GraphEdge, GraphNode } from '@/lib/db/queries/paths';
import { formatDuration } from '@/lib/utils';
import { useMapStore } from '@/stores/map-store';

import { createNode, deleteEdge, deleteNode, updateNode, upsertEdge } from '../actions';
import { NODE_STATUS_META, isNodeStatus } from '../lib/node-status';

/** Опрос статуса фоновой генерации: интервал и предел ожидания. */
const POLL_INTERVAL_MS = 5000;
const POLL_TIMEOUT_MS = 6 * 60 * 1000;

const RELATION_LABEL: Record<string, string> = {
  prerequisite: 'предпосылка',
  related: 'смежный',
  contrast: 'контраст',
  analogous: 'аналогия',
};

/**
 * Панель редактирования узла.
 *
 * Рёбра `related`/`contrast`/`analogous` — это пул для интерливинга:
 * из них движок практики берёт вопросы при `mix=true`.
 */
export function NodeInspector({
  node,
  pathId,
  siblings,
  edges,
}: {
  node: GraphNode;
  pathId: string;
  siblings: GraphNode[];
  edges: GraphEdge[];
}) {
  const router = useRouter();
  const select = useMapStore((s) => s.select);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const status = isNodeStatus(node.status) ? node.status : 'not_started';
  const meta = NODE_STATUS_META[status];
  const outgoing = edges.filter((e) => e.source === node.id);
  const titleById = new Map(siblings.map((s) => [s.id, s.title]));

  /**
   * Генерация идёт минуты и живёт на сервере: POST только ставит её в
   * очередь, дальше состояние опрашивается. Так закрытая вкладка не
   * обрывает работу, а вернувшийся пользователь видит актуальный статус.
   */
  async function generateModule() {
    setPending(true);
    setError(null);
    try {
      const response = await fetch('/api/ai/generate/module', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nodeId: node.id }),
      });
      const body = await response.json();
      if (!response.ok) {
        setError(body.error?.message ?? 'Не удалось запустить генерацию');
        setPending(false);
        return;
      }
      await pollModule();
    } catch {
      setError('Сеть недоступна. Попробуйте ещё раз.');
      setPending(false);
    }
  }

  async function pollModule() {
    const deadline = Date.now() + POLL_TIMEOUT_MS;

    while (Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));

      const response = await fetch(`/api/ai/generate/module?nodeId=${node.id}`);
      if (!response.ok) continue;
      const state = (await response.json()) as {
        contentReady: boolean;
        status: string | null;
        error: string | null;
      };

      if (state.contentReady) {
        setPending(false);
        router.refresh();
        return;
      }
      if (state.status === 'schema_failed' || state.status === 'provider_failed') {
        setError(
          state.status === 'schema_failed'
            ? 'Модель вернула материал не в том формате. Попробуйте ещё раз.'
            : 'Провайдер модели недоступен. Попробуйте позже.',
        );
        setPending(false);
        return;
      }
    }

    setError('Генерация идёт дольше обычного. Обновите страницу через пару минут.');
    setPending(false);
  }

  async function run(action: () => Promise<{ ok: boolean; error?: string }>) {
    setPending(true);
    setError(null);
    const result = await action();
    setPending(false);
    if (!result.ok) {
      setError(result.error ?? 'Не удалось выполнить действие');
      return;
    }
    router.refresh();
  }

  return (
    <aside className="flex w-80 shrink-0 flex-col gap-5 overflow-y-auto border-l border-border bg-bg-elevated/40 p-5">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <span
            aria-hidden
            className="size-2 rounded-full"
            style={{ backgroundColor: meta.color }}
          />
          <span className="text-xs" style={{ color: meta.text }}>
            {meta.label}
          </span>
          {meta.citation ? <ScienceHint citation={meta.citation} /> : null}
        </div>

        <Button size="icon" variant="ghost" onClick={() => select(null)} aria-label="Закрыть">
          <X aria-hidden />
        </Button>
      </div>

      <form
        className="flex flex-col gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          const form = new FormData(event.currentTarget);
          void run(() =>
            updateNode({
              nodeId: node.id,
              title: String(form.get('title') ?? ''),
              description: String(form.get('description') ?? '') || null,
              estimatedMinutes: Number(form.get('estimatedMinutes') ?? 20),
              weight: Number(form.get('weight') ?? 0.5),
            }),
          );
        }}
      >
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="title">Название</Label>
          <Input id="title" name="title" defaultValue={node.title} required />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="description">Описание</Label>
          <Textarea
            id="description"
            name="description"
            rows={3}
            defaultValue={node.description ?? ''}
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="estimatedMinutes">Минут</Label>
            <Input
              id="estimatedMinutes"
              name="estimatedMinutes"
              type="number"
              min={1}
              max={600}
              defaultValue={node.estimatedMinutes}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="weight">Важность 0–1</Label>
            <Input
              id="weight"
              name="weight"
              type="number"
              step="0.1"
              min={0}
              max={1}
              defaultValue={node.weight}
            />
          </div>
        </div>

        <Button type="submit" size="sm" disabled={pending} className="self-start">
          Сохранить
        </Button>
      </form>

      <section className="border-t border-border pt-4">
        <h3 className="text-xs font-medium text-fg-muted">Прогресс</h3>
        <dl className="mt-2 grid gap-1 text-xs text-fg-subtle">
          <div className="flex justify-between">
            <dt>Прочность знания</dt>
            <dd className="tabular-nums text-fg">{node.progress.knowledgeStrength}/100</dd>
          </div>
          <div className="flex justify-between">
            <dt className="flex items-center gap-1">
              Автоматизм
              <ScienceHint citation="automaticity" />
            </dt>
            <dd className="tabular-nums text-fg">
              {Math.round(node.progress.automaticityIndex * 100)}%
            </dd>
          </div>
          <div className="flex justify-between">
            <dt>Время до автоматизма</dt>
            <dd className="tabular-nums text-fg">
              {node.progress.timeToMasterySeconds
                ? formatDuration(node.progress.timeToMasterySeconds)
                : '—'}
            </dd>
          </div>
        </dl>
      </section>

      <section className="border-t border-border pt-4">
        <div className="flex items-center gap-1.5">
          <h3 className="text-xs font-medium text-fg-muted">Связи</h3>
          <ScienceHint citation="interleaving" />
        </div>

        {outgoing.length === 0 ? (
          <p className="mt-2 text-xs text-fg-subtle">
            Связей нет. Смежные узлы питают перемешанную практику.
          </p>
        ) : (
          <ul className="mt-2 flex flex-col gap-1">
            {outgoing.map((edge) => (
              <li
                key={`${edge.target}:${edge.relation}`}
                className="flex items-center justify-between gap-2 text-xs"
              >
                <span className="truncate text-fg-muted">
                  {RELATION_LABEL[edge.relation] ?? edge.relation} →{' '}
                  {titleById.get(edge.target) ?? '—'}
                </span>
                <button
                  type="button"
                  disabled={pending}
                  onClick={() =>
                    void run(() =>
                      deleteEdge({
                        sourceId: node.id,
                        targetId: edge.target,
                        relation: edge.relation,
                      }),
                    )
                  }
                  className="shrink-0 text-fg-subtle hover:text-red-400"
                  aria-label="Удалить связь"
                >
                  <Trash2 className="size-3.5" aria-hidden />
                </button>
              </li>
            ))}
          </ul>
        )}

        <AddEdgeForm
          nodeId={node.id}
          candidates={siblings.filter((s) => s.id !== node.id)}
          disabled={pending}
          onSubmit={(targetId, relation) =>
            void run(() => upsertEdge({ sourceId: node.id, targetId, relation }))
          }
        />
      </section>

      <section className="flex flex-col gap-2 border-t border-border pt-4">
        {node.contentReady ? (
          <Button size="sm" asChild className="w-full">
            <Link href={{ pathname: '/review', query: { nodeId: node.id } }}>
              <Dumbbell aria-hidden />
              Практика
            </Link>
          </Button>
        ) : null}
        <Button size="sm" variant="secondary" asChild className="w-full">
          <Link href={{ pathname: '/tutor', query: { nodeId: node.id } }}>
            <MessageCircle aria-hidden />
            Обсудить с тьютором
          </Link>
        </Button>
      </section>

      {!node.contentReady ? (
        <section className="border-t border-border pt-4">
          <Button
            size="sm"
            disabled={pending}
            onClick={() => void generateModule()}
            className="w-full"
          >
            <Sparkles aria-hidden />
            {pending ? 'Генерирую…' : 'Сгенерировать материал'}
          </Button>
        </section>
      ) : null}

      <section className="mt-auto border-t border-border pt-4">
        <div className="flex gap-2">
          <Button
            size="sm"
            variant="secondary"
            disabled={pending}
            onClick={() =>
              void run(() =>
                createNode({ pathId, parentId: node.id, title: 'Подузел' }),
              )
            }
          >
            Добавить подузел
          </Button>

          <Button
            size="sm"
            variant="danger"
            disabled={pending}
            onClick={() => {
              select(null);
              void run(() => deleteNode({ nodeId: node.id, cascade: false }));
            }}
          >
            Удалить
          </Button>
        </div>

        {error ? <p className="mt-2 text-xs text-red-400">{error}</p> : null}
      </section>
    </aside>
  );
}

function AddEdgeForm({
  nodeId,
  candidates,
  disabled,
  onSubmit,
}: {
  nodeId: string;
  candidates: GraphNode[];
  disabled: boolean;
  onSubmit: (targetId: string, relation: string) => void;
}) {
  const [targetId, setTargetId] = useState('');
  const [relation, setRelation] = useState('related');

  if (candidates.length === 0) return null;

  return (
    <div className="mt-3 flex flex-col gap-2">
      <select
        value={targetId}
        onChange={(event) => setTargetId(event.target.value)}
        className="h-8 rounded-md border border-border bg-bg px-2 text-xs text-fg"
        aria-label="Узел для связи"
      >
        <option value="">Выберите узел…</option>
        {candidates.map((candidate) => (
          <option key={candidate.id} value={candidate.id}>
            {candidate.title}
          </option>
        ))}
      </select>

      <div className="flex gap-2">
        <select
          value={relation}
          onChange={(event) => setRelation(event.target.value)}
          className="h-8 flex-1 rounded-md border border-border bg-bg px-2 text-xs text-fg"
          aria-label="Тип связи"
        >
          {Object.entries(RELATION_LABEL).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>

        <Button
          size="sm"
          variant="secondary"
          disabled={disabled || !targetId}
          onClick={() => {
            if (!targetId) return;
            onSubmit(targetId, relation);
            setTargetId('');
          }}
        >
          Связать
        </Button>
      </div>
      <input type="hidden" value={nodeId} readOnly />
    </div>
  );
}
