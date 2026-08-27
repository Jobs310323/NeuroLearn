'use client';

import { Handle, Position, type NodeProps } from '@xyflow/react';
import { BookOpen, Lock, Sparkles } from 'lucide-react';
import { memo } from 'react';

import { Progress } from '@/components/ui/progress';
import { cn, formatDueDate } from '@/lib/utils';

import { NODE_STATUS_META, isNodeStatus, type NodeStatus } from '../lib/node-status';

export type KnowledgeNodeData = {
  title: string;
  status: string;
  knowledgeStrength: number;
  automaticityIndex: number;
  contentReady: boolean;
  locked: boolean;
  dueAt: string | null;
  estimatedMinutes: number;
  /** Заметки тетради на узле — второй слой карты. */
  noteCount: number;
  noteDueCount: number;
};

function NodeCardComponent({ data, selected }: NodeProps) {
  const node = data as unknown as KnowledgeNodeData;
  const status: NodeStatus = isNodeStatus(node.status) ? node.status : 'not_started';
  const meta = NODE_STATUS_META[status];
  const due = node.dueAt ? new Date(node.dueAt) : null;
  const overdue = due ? due.getTime() <= Date.now() : false;

  return (
    <div
      className={cn(
        'w-60 rounded-card border bg-bg-elevated px-3 py-2.5 transition-shadow',
        selected ? 'border-accent shadow-lg' : 'border-border',
        node.locked && 'opacity-60',
      )}
      style={
        meta.ring !== 'transparent'
          ? { boxShadow: `0 0 0 1px ${meta.ring}, 0 0 18px -6px ${meta.ring}` }
          : undefined
      }
    >
      <Handle type="target" position={Position.Top} className="!size-1.5 !border-0 !bg-border-strong" />

      <div className="flex items-start gap-2">
        <span
          aria-hidden
          className="mt-1.5 size-2 shrink-0 rounded-full"
          style={{ backgroundColor: meta.color }}
        />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-fg">{node.title}</p>

          <div className="mt-1 flex items-center gap-1.5 text-[11px] text-fg-subtle">
            <span style={{ color: meta.text }}>{meta.label}</span>
            {node.locked ? (
              <>
                <span>·</span>
                <Lock className="size-3" aria-hidden />
                <span>заблокирован</span>
              </>
            ) : null}
            {status === 'automated' ? <Sparkles className="size-3" aria-hidden /> : null}
            {node.noteCount > 0 ? (
              <>
                <span>·</span>
                <BookOpen className="size-3" aria-hidden />
                <span
                  className="tabular-nums"
                  style={
                    node.noteDueCount > 0
                      ? { color: 'var(--color-status-has-gaps)' }
                      : undefined
                  }
                >
                  {node.noteCount}
                </span>
              </>
            ) : null}
          </div>
        </div>
      </div>

      {/* Прочность знания 0–100, а не очки: метрика из PRD, раздел 5.
          Цвет полосы — цвет статуса узла: полоса и точка статуса не должны
          рассказывать разные истории об одном узле. */}
      <Progress
        value={node.knowledgeStrength}
        color={meta.color}
        label={`Прочность знания: ${node.knowledgeStrength} из 100`}
        className="mt-2.5 h-1"
      />

      <div className="mt-1.5 flex items-center justify-between text-[11px] text-fg-subtle">
        <span>прочность {node.knowledgeStrength}</span>
        {due ? (
          <span className={overdue ? 'text-[var(--color-status-needs-review)]' : undefined}>
            {formatDueDate(due)}
          </span>
        ) : (
          <span>{node.contentReady ? `${node.estimatedMinutes} мин` : 'нет материала'}</span>
        )}
      </div>

      <Handle
        type="source"
        position={Position.Bottom}
        className="!size-1.5 !border-0 !bg-border-strong"
      />
    </div>
  );
}

export const NodeCard = memo(NodeCardComponent);
