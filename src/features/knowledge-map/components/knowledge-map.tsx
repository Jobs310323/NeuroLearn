'use client';

import {
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  applyNodeChanges,
  useReactFlow,
  type Edge,
  type Node,
  type NodeChange,
  type NodeMouseHandler,
} from '@xyflow/react';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { PathGraph } from '@/lib/db/queries/paths';
import { useMapStore } from '@/stores/map-store';

import { arrangeNodes, moveNodes } from '../actions';
import {
  computeLayout,
  type LayoutGrouping,
  type LayoutNode,
  type Positioned,
} from '../lib/compute-layout';
import {
  isSnapshotUsable,
  positionsDiffer,
  takeSnapshot,
  type LayoutSnapshot,
} from '../lib/layout-snapshot';
import { needsLayout } from '../lib/layout';
import { NODE_STATUS_META, isNodeStatus } from '../lib/node-status';
import { needsWorker, runLayout } from '../lib/run-layout';
import { NodeCard, type KnowledgeNodeData } from './node-card';
import { MapLegend } from './map-legend';
import { MapToolbar, type MapLayer } from './map-toolbar';
import { NoteSatellite, type NoteSatelliteData } from './note-satellite';

import '@xyflow/react/dist/style.css';

const nodeTypes = { knowledge: NodeCard, noteSatellite: NoteSatellite };

/**
 * Интерактивная карта знаний.
 *
 * Позиции применяются оптимистично: перетаскивание меняет состояние сразу,
 * запись в БД уходит с задержкой 500 мс одним батчем. Конфликт версии
 * раскладки не откатывает экран молча — он показывается человеку с
 * предложением обновить карту (иначе чужая расстановка пропадала бы, а
 * причина оставалась бы невидимой).
 */
export function KnowledgeMap({ graph }: { graph: PathGraph }) {
  return (
    <ReactFlowProvider>
      <KnowledgeMapInner graph={graph} />
    </ReactFlowProvider>
  );
}

/** Длительность переезда узлов после «Упорядочить» (токен движения). */
const ARRANGE_MS = 400;

function KnowledgeMapInner({ graph }: { graph: PathGraph }) {
  const router = useRouter();
  const select = useMapStore((s) => s.select);
  const hiddenStatuses = useMapStore((s) => s.hiddenStatuses);
  const { fitView } = useReactFlow();

  const initialNodes = useMemo(() => toFlowNodes(graph), [graph]);
  const [nodes, setNodes] = useState<Node[]>(initialNodes);
  const [layoutVersion, setLayoutVersion] = useState(graph.path.layoutVersion);
  const [grouping, setGrouping] = useState<LayoutGrouping>(
    isGrouping(graph.path.layoutGrouping) ? graph.path.layoutGrouping : 'bloom',
  );
  const [layer, setLayer] = useState<MapLayer>('map');
  const [snapshot, setSnapshot] = useState<LayoutSnapshot | null>(null);
  const [busy, setBusy] = useState(false);
  const [conflict, setConflict] = useState<string | null>(null);
  const [animating, setAnimating] = useState(false);

  const pendingRef = useRef(new Map<string, { x: number; y: number }>());
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const versionRef = useRef(layoutVersion);
  versionRef.current = layoutVersion;

  // Сервер — источник истины: при новом срезе пути пересобираем узлы.
  useEffect(() => {
    setNodes(toFlowNodes(graph));
    setLayoutVersion(graph.path.layoutVersion);
  }, [graph]);

  const noteCount = useMemo(
    () => graph.nodes.reduce((sum, node) => sum + node.notes.total, 0),
    [graph.nodes],
  );

  const satellites = useMemo(
    () => (layer === 'map' ? [] : toNoteSatellites(graph, nodes)),
    [layer, graph, nodes],
  );

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

  const visibleNodes = useMemo(() => {
    const knowledge =
      hiddenStatuses.size === 0
        ? nodes
        : nodes.filter((n) => {
            const status = (n.data as unknown as KnowledgeNodeData).status;
            return !(isNodeStatus(status) && hiddenStatuses.has(status));
          });

    if (layer === 'notes') {
      // Слой «Заметки»: узлы остаются подложкой, но приглушены — иначе
      // спутники читаются как самостоятельный граф, а они всегда чьи-то.
      return [
        ...knowledge.map((n) => ({ ...n, style: { ...n.style, opacity: 0.35 } })),
        ...satellites,
      ];
    }
    return [...knowledge, ...satellites];
  }, [nodes, hiddenStatuses, layer, satellites]);

  const flushPositions = useCallback(async () => {
    const pending = [...pendingRef.current.entries()].map(([nodeId, pos]) => ({
      nodeId,
      x: pos.x,
      y: pos.y,
    }));
    pendingRef.current.clear();
    if (pending.length === 0) return;

    const result = await moveNodes({
      pathId: graph.path.id,
      positions: pending,
      expectedLayoutVersion: versionRef.current,
    });

    if (result.ok) {
      setLayoutVersion(result.data.layoutVersion);
      setConflict(null);
      return;
    }

    setNodes(toFlowNodes(graph));
    setConflict(result.error);
  }, [graph]);

  const onNodesChange = useCallback(
    (changes: NodeChange[]) => {
      setNodes((current) => applyNodeChanges(changes, current));

      for (const change of changes) {
        // Спутники заметок позиционируются расчётом и не перетаскиваются:
        // их место — производная от места узла, а не самостоятельные данные.
        if (change.type === 'position' && change.position && change.dragging === false) {
          if (!change.id.startsWith('note:')) {
            pendingRef.current.set(change.id, change.position);
          }
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
    (_event, node) => {
      if (node.id.startsWith('note:')) {
        router.push(`/notes?note=${node.id.slice('note:'.length)}`);
        return;
      }
      select(node.id);
    },
    [select, router],
  );

  const applyPositions = useCallback(
    (positions: Positioned[]) => {
      const byId = new Map(positions.map((p) => [p.id, p]));
      setNodes((current) =>
        current.map((node) => {
          const next = byId.get(node.id);
          return next ? { ...node, position: { x: next.x, y: next.y } } : node;
        }),
      );
    },
    [],
  );

  /** «Упорядочить»: расчёт → снимок «до» → анимация → запись. */
  const arrange = useCallback(async () => {
    setBusy(true);
    setConflict(null);
    try {
      const before = nodes
        .filter((n) => !n.id.startsWith('note:'))
        .map((n) => ({ id: n.id, x: n.position.x, y: n.position.y }));

      const positions = await runLayout(
        { nodes: graph.nodes.map(toLayoutNode), edges: graph.edges },
        grouping,
      );

      if (!positionsDiffer(before, positions)) {
        // Карта уже разложена так же: молча ничего не делаем, но и снимок
        // не перетираем — иначе «Отменить» после второго нажатия отменяло бы
        // пустую операцию вместо настоящей раскладки.
        return;
      }

      setSnapshot(takeSnapshot(before, layoutVersion, 'Упорядочить'));

      const reduceMotion =
        typeof window !== 'undefined' &&
        window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      if (!reduceMotion) {
        setAnimating(true);
        setTimeout(() => setAnimating(false), ARRANGE_MS);
      }
      applyPositions(positions);

      const result = await arrangeNodes({
        pathId: graph.path.id,
        grouping,
        expectedLayoutVersion: layoutVersion,
        positions: positions.map((p) => ({ nodeId: p.id, x: p.x, y: p.y })),
      });

      if (!result.ok) {
        setNodes(toFlowNodes(graph));
        setSnapshot(null);
        setConflict(result.error);
        return;
      }

      setLayoutVersion(result.data.layoutVersion);
      // Zoom-to-fit после раскладки: карта, которая «упорядочилась» за краем
      // экрана, выглядит сломанной.
      setTimeout(() => fitView({ duration: reduceMotion ? 0 : ARRANGE_MS, padding: 0.15 }), 30);
    } finally {
      setBusy(false);
    }
  }, [applyPositions, fitView, graph, grouping, layoutVersion, nodes]);

  const undo = useCallback(async () => {
    if (!isSnapshotUsable(snapshot)) {
      setSnapshot(null);
      return;
    }
    setBusy(true);
    try {
      applyPositions(snapshot.positions);
      const result = await arrangeNodes({
        pathId: graph.path.id,
        grouping,
        expectedLayoutVersion: layoutVersion,
        positions: snapshot.positions.map((p) => ({ nodeId: p.id, x: p.x, y: p.y })),
      });
      if (!result.ok) {
        setNodes(toFlowNodes(graph));
        setConflict(result.error);
        return;
      }
      setLayoutVersion(result.data.layoutVersion);
      setSnapshot(null);
      setTimeout(() => fitView({ duration: ARRANGE_MS, padding: 0.15 }), 30);
    } finally {
      setBusy(false);
    }
  }, [applyPositions, fitView, graph, grouping, layoutVersion, snapshot]);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  return (
    <div className="relative size-full">
      {busy && needsWorker(graph.nodes.length) ? (
        <div
          aria-hidden
          className="absolute inset-0 z-20 animate-pulse bg-gradient-to-br from-[#1A1F33] to-[#2A2F4A] opacity-40"
        />
      ) : null}

      <ReactFlow
        nodes={visibleNodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onNodeClick={onNodeClick}
        onPaneClick={() => select(null)}
        fitView
        minZoom={0.1}
        maxZoom={1.8}
        proOptions={{ hideAttribution: true }}
        className={animating ? 'map-arranging' : undefined}
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

      <MapToolbar
        grouping={grouping}
        onGroupingChange={setGrouping}
        onArrange={() => void arrange()}
        onFit={() => fitView({ duration: 250, padding: 0.15 })}
        onUndo={() => void undo()}
        canUndo={isSnapshotUsable(snapshot)}
        busy={busy}
        layer={layer}
        onLayerChange={setLayer}
        noteCount={noteCount}
        conflict={conflict}
        onReload={() => {
          setConflict(null);
          router.refresh();
        }}
      />

      <MapLegend stats={graph.stats} />
    </div>
  );
}

function isGrouping(value: string): value is LayoutGrouping {
  return value === 'bloom' || value === 'prerequisite' || value === 'status' || value === 'module';
}

function toLayoutNode(node: PathGraph['nodes'][number]): LayoutNode {
  return {
    id: node.id,
    parentId: node.parentId,
    orderIndex: node.orderIndex,
    status: node.status,
    cognitiveLevel: node.cognitiveLevel,
  };
}

function toFlowNodes(graph: PathGraph): Node[] {
  const layout = needsLayout(graph.nodes)
    ? new Map(
        // Первая раскладка нового пути — тем же движком, что и кнопка:
        // иначе «Упорядочить» сразу после генерации дерева заметно двигало бы
        // карту, хотя человек ничего не менял.
        computeInitialLayout(graph).map((p) => [p.id, p]),
      )
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
      noteCount: node.notes.total,
      noteDueCount: node.notes.due,
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

/**
 * Синхронный вариант для первого показа. Воркер здесь не нужен: путь без
 * координат только что создан и большим не бывает.
 */
function computeInitialLayout(graph: PathGraph): Positioned[] {
  return computeLayout(
    { nodes: graph.nodes.map(toLayoutNode), edges: graph.edges },
    { grouping: isGrouping(graph.path.layoutGrouping) ? graph.path.layoutGrouping : 'bloom' },
  ).positions;
}

/**
 * Спутники заметок: заметки узла раскладываются по орбите вокруг него.
 *
 * Позиции считаются, а не перетаскиваются (решение из плана): место заметки
 * на карте — производная от её якоря. Разрешить двигать её отдельно значило
 * бы дать координатам заметки собственный смысл, которого у них нет.
 */
function toNoteSatellites(graph: PathGraph, flowNodes: Node[]): Node[] {
  const positionById = new Map(flowNodes.map((n) => [n.id, n.position]));
  const satellites: Node[] = [];

  for (const node of graph.nodes) {
    if (node.notes.total === 0) continue;
    const base = positionById.get(node.id);
    if (!base) continue;

    const data: NoteSatelliteData = {
      nodeTitle: node.title,
      total: node.notes.total,
      due: node.notes.due,
      confusion: node.notes.confusion,
    };

    satellites.push({
      id: `note:${node.id}`,
      type: 'noteSatellite',
      draggable: false,
      selectable: true,
      position: { x: base.x + 190, y: base.y - 46 },
      data: data as unknown as Record<string, unknown>,
    });
  }

  return satellites;
}
