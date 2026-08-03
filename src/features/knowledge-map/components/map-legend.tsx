'use client';

import { ScienceHint } from '@/components/science-hint';
import { cn } from '@/lib/utils';
import { useMapStore } from '@/stores/map-store';

import { NODE_STATUS_META, NODE_STATUS_ORDER } from '../lib/node-status';

/** Легенда карты. Клик по статусу скрывает его узлы — быстрый фокус на нужном срезе. */
export function MapLegend({
  stats,
}: {
  stats: { total: number; mastered: number; automated: number; needsReview: number; hasGaps: number };
}) {
  const hidden = useMapStore((s) => s.hiddenStatuses);
  const toggle = useMapStore((s) => s.toggleStatusFilter);

  return (
    <div className="pointer-events-auto absolute left-4 top-4 rounded-card border border-border bg-bg-elevated/90 p-3 backdrop-blur">
      <div className="mb-2 flex items-center gap-1.5 text-xs text-fg-muted">
        <span>
          {stats.total} узлов · освоено {stats.mastered} · автоматизм {stats.automated}
        </span>
      </div>

      <ul className="flex flex-col gap-1">
        {NODE_STATUS_ORDER.map((status) => {
          const meta = NODE_STATUS_META[status];
          const isHidden = hidden.has(status);
          return (
            <li key={status}>
              <button
                type="button"
                onClick={() => toggle(status)}
                aria-pressed={!isHidden}
                title={meta.hint}
                className={cn(
                  'flex w-full items-center gap-2 rounded px-1.5 py-1 text-left text-xs transition-colors',
                  'hover:bg-bg-hover',
                  isHidden && 'opacity-40',
                )}
              >
                <span
                  aria-hidden
                  className="size-2 shrink-0 rounded-full"
                  style={{ backgroundColor: meta.color }}
                />
                <span className="text-fg-muted">{meta.label}</span>
                {meta.citation ? (
                  <ScienceHint citation={meta.citation} side="right" className="ml-auto" />
                ) : null}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
