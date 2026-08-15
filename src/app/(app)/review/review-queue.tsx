'use client';

import { Flame, Repeat, Sparkles } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { ReviewQueue } from '@/lib/db/queries/review';
import { cn } from '@/lib/utils';

import { PracticeRunner } from './practice-runner';

const STATE_LABEL: Record<string, string> = {
  new: 'новая',
  learning: 'изучается',
  review: 'на повторении',
  relearning: 'переучивается',
};

export function ReviewQueueView({
  initialQueue,
  initialNodeId,
}: {
  initialQueue: ReviewQueue;
  initialNodeId: string | null;
}) {
  const router = useRouter();
  const [activeNodeId, setActiveNodeId] = useState<string | null>(initialNodeId);
  const [fromQueue, setFromQueue] = useState(false);
  const { due, counts } = initialQueue;

  if (activeNodeId) {
    return (
      <PracticeRunner
        nodeId={activeNodeId}
        mode={fromQueue ? 'review' : 'focused'}
        mix={!fromQueue}
        onDone={() => {
          setActiveNodeId(null);
          setFromQueue(false);
          router.refresh();
        }}
      />
    );
  }

  return (
    <div className="mt-8 flex flex-col gap-6">
      <div className="grid grid-cols-3 gap-3">
        <StatTile icon={Flame} label="Просрочено" value={counts.overdue} tone="amber" />
        <StatTile icon={Repeat} label="Сегодня" value={counts.today} tone="accent" />
        <StatTile icon={Sparkles} label="На неделю" value={counts.upcoming7d} tone="neutral" />
      </div>

      {due.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Повторять пока нечего</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-fg-muted">
            Очередь заполнится сама, как только у узлов появится материал и пройдёт время
            по расписанию FSRS.
          </CardContent>
        </Card>
      ) : (
        <ul className="flex flex-col gap-2">
          {due.map((item) => (
            <li key={item.cardId}>
              <button
                type="button"
                onClick={() => {
                  setFromQueue(true);
                  setActiveNodeId(item.nodeId);
                }}
                className="flex w-full items-center justify-between gap-4 rounded-card border border-border bg-bg-elevated p-4 text-left transition-colors hover:bg-bg-hover"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-fg">{item.nodeTitle}</p>
                  <p className="truncate text-xs text-fg-subtle">{item.pathTitle}</p>
                </div>
                <div className="flex shrink-0 items-center gap-3 text-xs text-fg-subtle">
                  <span>{STATE_LABEL[item.state] ?? item.state}</span>
                  <span className="tabular-nums">
                    R {Math.round(item.retrievability * 100)}%
                  </span>
                  <span>{new Date(item.due).toLocaleDateString('ru-RU')}</span>
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function StatTile({
  icon: Icon,
  label,
  value,
  tone,
}: {
  icon: typeof Flame;
  label: string;
  value: number;
  tone: 'amber' | 'accent' | 'neutral';
}) {
  return (
    <div className="rounded-card border border-border bg-bg-elevated p-4">
      <div
        className={cn(
          'flex items-center gap-1.5 text-xs',
          tone === 'amber' && 'text-amber-500',
          tone === 'accent' && 'text-accent',
          tone === 'neutral' && 'text-fg-subtle',
        )}
      >
        <Icon className="size-3.5" aria-hidden />
        {label}
      </div>
      <p className="mt-1 text-2xl font-semibold tabular-nums text-fg">{value}</p>
    </div>
  );
}
