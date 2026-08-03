import type { GraphEdge, GraphNode } from '@/lib/db/queries/paths';

/**
 * Авто-раскладка дерева знаний.
 *
 * Простой уровневый алгоритм вместо elkjs: дерево строится по `parentId`,
 * узлы одного уровня раскладываются по горизонтали, поддеревья центрируются
 * под родителем. Детерминирован, работает синхронно и не тянет воркер —
 * на личных объёмах (сотни узлов) этого достаточно.
 */

const NODE_WIDTH = 240;
const H_GAP = 40;
const V_GAP = 130;

export type Positioned = { id: string; x: number; y: number };

export function layoutTree(nodes: GraphNode[]): Positioned[] {
  if (nodes.length === 0) return [];

  const byParent = new Map<string | null, GraphNode[]>();
  for (const node of nodes) {
    const key = node.parentId;
    const list = byParent.get(key);
    if (list) list.push(node);
    else byParent.set(key, [node]);
  }
  for (const list of byParent.values()) {
    list.sort((a, b) => a.orderIndex - b.orderIndex);
  }

  const positions = new Map<string, Positioned>();
  let cursor = 0;

  function place(node: GraphNode, depth: number): number {
    const children = byParent.get(node.id) ?? [];

    if (children.length === 0) {
      const x = cursor * (NODE_WIDTH + H_GAP);
      cursor += 1;
      positions.set(node.id, { id: node.id, x, y: depth * V_GAP });
      return x;
    }

    const childCenters = children.map((child) => place(child, depth + 1));
    const first = childCenters[0]!;
    const last = childCenters[childCenters.length - 1]!;
    const x = (first + last) / 2;
    positions.set(node.id, { id: node.id, x, y: depth * V_GAP });
    return x;
  }

  const roots = byParent.get(null) ?? [];
  for (const root of roots) place(root, 0);

  // Узлы с недостижимым родителем (сирота после ручных правок) — в конец.
  for (const node of nodes) {
    if (!positions.has(node.id)) {
      positions.set(node.id, {
        id: node.id,
        x: cursor * (NODE_WIDTH + H_GAP),
        y: (node.depth || 0) * V_GAP,
      });
      cursor += 1;
    }
  }

  return [...positions.values()];
}

/** Узлы, у которых координаты ещё не задавались (все нули) — им нужна раскладка. */
export function needsLayout(nodes: GraphNode[]): boolean {
  return nodes.length > 1 && nodes.every((n) => n.position.x === 0 && n.position.y === 0);
}

export function edgeKey(edge: GraphEdge): string {
  return `${edge.source}:${edge.target}:${edge.relation}`;
}
