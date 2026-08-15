'use client';

import { Flame, Repeat, Sparkles, WifiOff } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { ReviewQueue } from '@/lib/db/queries/review';
import { enqueuePendingGrade } from '@/lib/offline/local-review-queue';
import { cn } from '@/lib/utils';

import { PracticeRunner } from './practice-runner';

/** Оценки по памяти (без разбора задания) — единственное, что можно делать офлайн: AI-разбор ответа требует сети. */
const OFFLINE_RATINGS: { rating: 'again' | 'hard' | 'good' | 'easy'; label: string }[] = [
  { rating: 'again', label: 'Забыл' },
  { rating: 'hard', label: 'С трудом' },
  { rating: 'good', label: 'Вспомнил' },
  { rating: 'easy', label: 'Легко' },
];

function useOnlineStatus(): boolean {
  const [online, setOnline] = useState(true);
  useEffect(() => {
    setOnline(navigator.onLine);
    const set = () => setOnline(navigator.onLine);
    window.addEventListener('online', set);
    window.addEventListener('offline', set);
    return () => {
      window.removeEventListener('online', set);
      window.removeEventListener('offline', set);
    };
  }, []);
  return online;
}

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
  const online = useOnlineStatus();
  const [activeNodeId, setActiveNodeId] = useState<string | null>(initialNodeId);
  const [fromQueue, setFromQueue] = useState(false);
  const [ratedOffline, setRatedOffline] = useState<Set<string>>(new Set());
  const { due, counts } = initialQueue;

  async function rateOffline(cardId: string, nodeTitle: string, rating: (typeof OFFLINE_RATINGS)[number]['rating']) {
    await enqueuePendingGrade({ cardId, nodeTitle, rating, reviewedAt: new Date().toISOString() });
    setRatedOffline((prev) => new Set(prev).add(cardId));
  }

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
      {!online ? (
        <div className="flex items-center gap-2 rounded-card border border-amber-500/30 bg-amber-500/10 px-4 py-2.5 text-xs text-amber-500">
          <WifiOff className="size-3.5 shrink-0" aria-hidden />
          Нет сети — полный разбор недоступен, но можно оценить карточки по памяти. Оценки уйдут на
          сервер, когда сеть вернётся.
        </div>
      ) : null}

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
            <li
              key={item.cardId}
              className="flex flex-col gap-3 rounded-card border border-border bg-bg-elevated p-4 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-fg">{item.nodeTitle}</p>
                <p className="truncate text-xs text-fg-subtle">{item.pathTitle}</p>
                <div className="mt-1 flex items-center gap-3 text-xs text-fg-subtle">
                  <span>{STATE_LABEL[item.state] ?? item.state}</span>
                  <span className="tabular-nums">R {Math.round(item.retrievability * 100)}%</span>
                  <span>{new Date(item.due).toLocaleDateString('ru-RU')}</span>
                </div>
              </div>

              {online ? (
                <Button
                  variant="secondary"
                  onClick={() => {
                    setFromQueue(true);
                    setActiveNodeId(item.nodeId);
                  }}
                >
                  Пройти
                </Button>
              ) : ratedOffline.has(item.cardId) ? (
                <span className="text-xs text-fg-subtle">Оценено, ждёт синхронизации</span>
              ) : (
                <div className="flex shrink-0 flex-wrap gap-1.5">
                  {OFFLINE_RATINGS.map((r) => (
                    <Button
                      key={r.rating}
                      variant="secondary"
                      className="px-2.5 py-1 text-xs"
                      onClick={() => void rateOffline(item.cardId, item.nodeTitle, r.rating)}
                    >
                      {r.label}
                    </Button>
                  ))}
                </div>
              )}
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
