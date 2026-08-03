'use client';

import {
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  applyNodeChanges,
  type Edge,
  type Node,
  type NodeChange,
  type NodeMouseHandler,
} from '@xyflow/react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { PathGraph } from '@/lib/db/queries/paths';
import { useMapStore } from '@/stores/map-store';

import { moveNodes } from '../actions';
import { layoutTree, needsLayout } from '../lib/layout';
import { NODE_STATUS_META, isNodeStatus } from '../lib/node-status';
import { NodeCard, type KnowledgeNodeData } from './node-card';
import { MapLegend } from './map-legend';

import '@xyflow/react/dist/style.css';

const nodeTypes = { knowledge: NodeCard };

/**
 * Интерактивная карта знаний.
 *
 * Позиции применяются оптимистично: перетаскивание меняет состояние сразу,
 * запись в БД уходит с задержкой 500 мс одним батчем. Ошибка записи
 * откатывает координаты к серверным.
 */
export function KnowledgeMap({ graph }: { graph: PathGraph }) {
  return (
    <ReactFlowProvider>
      <KnowledgeMapInner graph={graph} />
    </ReactFlowProvider>
  );
}

function KnowledgeMapInner({ graph }: { graph: PathGraph }) {
  const select = useMapStore((s) => s.select);
  const hiddenStatuses = useMapStore((s) => s.hiddenStatuses);

  const initialNodes = useMemo(() => toFlowNodes(graph), [graph]);
  const [nodes, setNodes] = useState<Node[]>(initialNodes);
  const pendingRef = useRef(new Map<string, { x: number; y: number }>());
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Сервер — источник истины: при новом срезе пути пересобираем узлы.
  useEffect(() => setNodes(initialNodes), [initialNodes]);

  const edges = useMemo<Edge[]>(
    () =>
      graph.edges.map((edge) => ({
        id: `${edge.source}:${edge.target}:${edge.relation}`,
        source: edge.source,
        target: edge.target,
        animated: edge.relation === 'prerequisite',
        style: {
          strokeDasharray: edge.relation === 'prerequisite' ? undefined : '4 4',
          strokeWidth: 1 + edge.strength,
          opacity: edge.relation === 'prerequisite' ? 0.9 : 0.45,
        },
      })),
    [graph.edges],
  );

  const visibleNodes = useMemo(
    () =>
      hiddenStatuses.size === 0
        ? nodes
        : nodes.filter((n) => {
            const status = (n.data as unknown as KnowledgeNodeData).status;
            return !(isNodeStatus(status) && hiddenStatuses.has(status));
          }),
    [nodes, hiddenStatuses],
  );

  const flushPositions = useCallback(async () => {
    const pending = [...pendingRef.current.entries()].map(([nodeId, pos]) => ({
      nodeId,
      x: pos.x,
      y: pos.y,
    }));
    pendingRef.current.clear();
    if (pending.length === 0) return;

    const result = await moveNodes({ pathId: graph.path.id, positions: pending });
    if (!result.ok) setNodes(toFlowNodes(graph));
  }, [graph]);

  const onNodesChange = useCallback(
    (changes: NodeChange[]) => {
      setNodes((current) => applyNodeChanges(changes, current));

      for (const change of changes) {
        if (change.type === 'position' && change.position && change.dragging === false) {
          pendingRef.current.set(change.id, change.position);
        }
      }

      if (pendingRef.current.size > 0) {
        if (timerRef.current) clearTimeout(timerRef.current);
        timerRef.current = setTimeout(() => void flushPositions(), 500);
      }
    },
    [flushPositions],
  );

  const onNodeClick = useCallback<NodeMouseHandler>(
    (_event, node) => select(node.id),
    [select],
  );

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  return (
    <div className="relative size-full">
      <ReactFlow
        nodes={visibleNodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onNodeClick={onNodeClick}
        onPaneClick={() => select(null)}
        fitView
        minZoom={0.2}
        maxZoom={1.8}
        proOptions={{ hideAttribution: true }}
      >
        <Background variant={BackgroundVariant.Dots} gap={20} size={1} color="#2a2f3d" />
        <Controls showInteractive={false} className="!bg-bg-elevated !border-border" />
        <MiniMap
          pannable
          zoomable
          nodeColor={(node) => {
            const status = (node.data as unknown as KnowledgeNodeData).status;
            return isNodeStatus(status)
              ? NODE_STATUS_META[status].color
              : 'var(--color-status-not-started)';
          }}
          maskColor="rgba(0,0,0,0.6)"
          className="!bg-bg-elevated !border-border"
        />
      </ReactFlow>

      <MapLegend stats={graph.stats} />
    </div>
  );
}

function toFlowNodes(graph: PathGraph): Node[] {
  const layout = needsLayout(graph.nodes)
    ? new Map(layoutTree(graph.nodes).map((p) => [p.id, p]))
    : null;

  return graph.nodes.map((node) => {
    const placed = layout?.get(node.id);
    const data: KnowledgeNodeData = {
      title: node.title,
      status: node.status,
      knowledgeStrength: node.progress.knowledgeStrength,
      automaticityIndex: node.progress.automaticityIndex,
      contentReady: node.contentReady,
      locked: node.locked,
      dueAt: node.review?.due ?? null,
      estimatedMinutes: node.estimatedMinutes,
    };

    return {
      id: node.id,
      type: 'knowledge',
      position: placed
        ? { x: placed.x, y: placed.y }
        : { x: node.position.x, y: node.position.y },
      data: data as unknown as Record<string, unknown>,
    };
  });
}
