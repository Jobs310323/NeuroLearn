'use client';

import { LayoutGrid, Loader2, Maximize, Undo2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/input';
import { cn } from '@/lib/utils';

import { LAYOUT_GROUPING_LABEL, type LayoutGrouping } from '../lib/compute-layout';

export type MapLayer = 'map' | 'notes' | 'both';

const LAYER_LABEL: Record<MapLayer, string> = {
  map: 'Карта',
  notes: 'Заметки',
  both: 'Обе',
};

/**
 * Панель управления картой.
 *
 * «Упорядочить» и «Вписать в кадр» — разные кнопки намеренно. Первая меняет
 * данные (координаты узлов в базе) и обратима одним шагом; вторая меняет
 * только камеру и не трогает ничего. Смешивать их в одной кнопке значило бы
 * прятать запись в базу за безобидным действием.
 */
export function MapToolbar({
  grouping,
  onGroupingChange,
  onArrange,
  onFit,
  onUndo,
  canUndo,
  busy,
  layer,
  onLayerChange,
  noteCount,
  conflict,
  onReload,
}: {
  grouping: LayoutGrouping;
  onGroupingChange: (grouping: LayoutGrouping) => void;
  onArrange: () => void;
  onFit: () => void;
  onUndo: () => void;
  canUndo: boolean;
  busy: boolean;
  layer: MapLayer;
  onLayerChange: (layer: MapLayer) => void;
  noteCount: number;
  conflict: string | null;
  onReload: () => void;
}) {
  return (
    <div className="pointer-events-none absolute left-3 top-3 z-10 flex max-w-[calc(100%-1.5rem)] flex-col gap-2">
      <div className="pointer-events-auto flex flex-wrap items-center gap-1.5 rounded-card border border-border bg-bg-elevated/95 p-1.5 backdrop-blur">
        <Button size="sm" onClick={onArrange} disabled={busy} data-tour="arrange">
          {busy ? <Loader2 className="animate-spin" aria-hidden /> : <LayoutGrid aria-hidden />}
          Упорядочить
        </Button>

        <Label className="sr-only" htmlFor="map-grouping">
          Режим группировки
        </Label>
        <select
          id="map-grouping"
          value={grouping}
          onChange={(e) => onGroupingChange(e.target.value as LayoutGrouping)}
          className="h-8 rounded-md border border-border bg-bg px-2 text-xs text-fg"
        >
          {Object.entries(LAYOUT_GROUPING_LABEL).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>

        <Button size="sm" variant="secondary" onClick={onFit}>
          <Maximize aria-hidden />
          Вписать в кадр
        </Button>

        <Button
          size="sm"
          variant="ghost"
          onClick={onUndo}
          disabled={!canUndo || busy}
          title={canUndo ? 'Вернуть раскладку, которая была до «Упорядочить»' : undefined}
        >
          <Undo2 aria-hidden />
          Отменить
        </Button>
      </div>

      <div
        className="pointer-events-auto flex items-center gap-1 rounded-card border border-border bg-bg-elevated/95 p-1 text-xs backdrop-blur"
        role="group"
        aria-label="Слои карты"
      >
        {(Object.keys(LAYER_LABEL) as MapLayer[]).map((value) => (
          <button
            key={value}
            type="button"
            onClick={() => onLayerChange(value)}
            aria-pressed={layer === value}
            className={cn(
              'rounded px-2 py-1 transition-colors',
              layer === value ? 'bg-bg-hover text-fg' : 'text-fg-muted hover:text-fg',
            )}
          >
            {LAYER_LABEL[value]}
            {value !== 'map' && noteCount > 0 ? (
              <span className="ml-1 tabular-nums text-fg-subtle">{noteCount}</span>
            ) : null}
          </button>
        ))}
      </div>

      {conflict ? (
        <div
          role="alert"
          className="pointer-events-auto max-w-md rounded-card border border-[var(--color-status-has-gaps)] bg-bg-elevated/95 p-2.5 text-xs text-fg backdrop-blur"
        >
          <p>{conflict}</p>
          <Button size="sm" variant="secondary" className="mt-2" onClick={onReload}>
            Обновить карту
          </Button>
        </div>
      ) : null}
    </div>
  );
}
