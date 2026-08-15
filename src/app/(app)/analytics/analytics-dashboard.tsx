'use client';

import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import type { AnalyticsOverview } from '@/lib/db/queries/analytics';
import { cn } from '@/lib/utils';

const MASTERY_LABEL: Record<keyof AnalyticsOverview['mastery'], string> = {
  notStarted: 'Не начато',
  inProgress: 'В процессе',
  mastered: 'Освоено',
  automated: 'Автоматизм',
  hasGaps: 'Есть пробелы',
  needsReview: 'Пора повторить',
};

export function AnalyticsDashboard({ data, className }: { data: AnalyticsOverview; className?: string }) {
  const totalNodes = Object.values(data.mastery).reduce((a, b) => a + b, 0);

  return (
    <div className={cn('flex flex-col gap-6', className)}>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {(Object.keys(data.mastery) as (keyof AnalyticsOverview['mastery'])[]).map((key) => (
          <div key={key} className="rounded-card border border-border p-3">
            <p className="text-xs text-fg-muted">{MASTERY_LABEL[key]}</p>
            <p className="mt-1 text-xl font-semibold tabular-nums">{data.mastery[key]}</p>
          </div>
        ))}
      </div>
      {totalNodes === 0 ? (
        <p className="text-sm text-fg-subtle">
          Данных пока нет — начните практику хотя бы по одному узлу.
        </p>
      ) : null}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Распределение прочности знаний</CardTitle>
            <CardDescription>Композит retrievability × точность × скорость × охват (PRD §5)</CardDescription>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={data.strengthDistribution}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-border" vertical={false} />
                <XAxis dataKey="bucket" fontSize={12} tickLine={false} axisLine={false} />
                <YAxis fontSize={12} allowDecimals={false} tickLine={false} axisLine={false} />
                <Tooltip
                  cursor={{ fill: 'var(--color-bg-hover)' }}
                  contentStyle={{ background: 'var(--color-bg-elevated)', border: '1px solid var(--color-border)', fontSize: 12 }}
                />
                <Bar dataKey="count" fill="var(--color-accent)" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Эффект интерливинга</CardTitle>
            <CardDescription>
              Просадка точности на перемешанной практике ожидаема — это желательная трудность, не регресс
              (Bjork &amp; Bjork, 2011). Сравнивать нужно отложенное удержание, а не результат одной сессии.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex items-end gap-8">
              <Stat label="Блочная практика" value={data.interleavingEffect.blockedAccuracy} />
              <Stat label="Интерливинг" value={data.interleavingEffect.interleavedAccuracy} />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Время до мастерства</CardTitle>
            <CardDescription>Единственная метрика, которую стоит сравнивать «с собой прошлым»</CardDescription>
          </CardHeader>
          <CardContent>
            {data.timeToMastery.medianSeconds != null ? (
              <p className="text-2xl font-semibold tabular-nums">
                {formatDuration(data.timeToMastery.medianSeconds)}{' '}
                <span className="text-sm font-normal text-fg-muted">медиана</span>
              </p>
            ) : (
              <p className="text-sm text-fg-subtle">Ещё ни один узел не дошёл до automated.</p>
            )}
            {data.timeToMastery.byNode.length > 0 ? (
              <ul className="mt-3 flex flex-col gap-1 text-xs text-fg-muted">
                {data.timeToMastery.byNode.slice(0, 5).map((n) => (
                  <li key={n.nodeId} className="flex justify-between gap-2">
                    <span className="truncate">{n.title}</span>
                    <span className="shrink-0 tabular-nums">{formatDuration(n.seconds)}</span>
                  </li>
                ))}
              </ul>
            ) : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Калибровка</CardTitle>
            <CardDescription>Уверенность, заявленная до показа результата, против фактической точности</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex items-end gap-8">
              <Stat label="Уверенность" value={data.calibration.meanConfidence} />
              <Stat label="Точность" value={data.calibration.accuracy} />
            </div>
            {data.calibration.gap != null ? (
              <p className="mt-2 text-xs text-fg-muted">
                Разрыв: {data.calibration.gap >= 0 ? '+' : ''}
                {Math.round(data.calibration.gap * 100)}%{' '}
                {data.calibration.gap > 0.1 ? '— возможна переоценка себя' : ''}
              </p>
            ) : null}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number | null }) {
  return (
    <div>
      <p className="text-xs text-fg-muted">{label}</p>
      <p className="text-2xl font-semibold tabular-nums">{value != null ? `${Math.round(value * 100)}%` : '—'}</p>
    </div>
  );
}

function formatDuration(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.round((seconds % 3600) / 60);
  if (hours > 0) return `${hours} ч ${minutes} мин`;
  return `${minutes} мин`;
}
