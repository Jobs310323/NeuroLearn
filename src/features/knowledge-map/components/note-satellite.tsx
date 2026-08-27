'use client';

import { BookOpen, HelpCircle } from 'lucide-react';
import { memo } from 'react';

import type { NodeProps } from '@xyflow/react';

export type NoteSatelliteData = {
  nodeTitle: string;
  total: number;
  due: number;
  confusion: number;
};

/**
 * Спутник заметок на орбите узла — слой «Заметки» карты знаний.
 *
 * Показывает счётчики, а не тексты: карта отвечает на вопрос «где мои мысли»,
 * читать их надо в тетради. Цвет здесь тоже данные: «пора перечитать»
 * подсвечивается тем же янтарным, что и пробел, потому что это про то же —
 * знание под заметкой просело.
 */
function NoteSatelliteComponent({ data }: NodeProps) {
  const note = data as unknown as NoteSatelliteData;
  const due = note.due > 0;

  return (
    <div
      className="flex items-center gap-1.5 rounded-full border bg-bg-elevated/95 px-2.5 py-1 text-[11px] backdrop-blur"
      style={{
        borderColor: due ? 'var(--color-status-has-gaps)' : 'var(--color-border)',
        color: due ? 'var(--color-status-has-gaps)' : 'var(--color-fg-muted)',
      }}
      title={`Заметки узла «${note.nodeTitle}»`}
    >
      <BookOpen className="size-3" aria-hidden />
      <span className="tabular-nums">{note.total}</span>
      {due ? <span>· перечитать {note.due}</span> : null}
      {note.confusion > 0 ? (
        <>
          <HelpCircle className="size-3" aria-hidden />
          <span className="tabular-nums">{note.confusion}</span>
        </>
      ) : null}
    </div>
  );
}

export const NoteSatellite = memo(NoteSatelliteComponent);
