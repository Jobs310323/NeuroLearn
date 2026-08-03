import { and, eq, inArray } from 'drizzle-orm';

import type { Db } from '@/lib/db';
import { nodeEdges } from '@/lib/db/schema';

/**
 * Проверка, что новое ребро `prerequisite` не создаёт цикл.
 *
 * БД ацикличность не гарантирует, поэтому проверяем перед вставкой:
 * если из `targetId` уже достижим `sourceId`, добавление
 * `sourceId -> targetId` замкнёт граф.
 *
 * Обход в ширину, слоями — на личных объёмах (сотни узлов) это несколько
 * запросов, а не рекурсивный CTE.
 */
export async function wouldCreateCycle(
  db: Db,
  sourceId: string,
  targetId: string,
): Promise<boolean> {
  if (sourceId === targetId) return true;

  const visited = new Set<string>([targetId]);
  let frontier = [targetId];

  while (frontier.length > 0) {
    const rows = await db
      .select({ target: nodeEdges.targetId })
      .from(nodeEdges)
      .where(
        and(inArray(nodeEdges.sourceId, frontier), eq(nodeEdges.relation, 'prerequisite')),
      );

    const next: string[] = [];
    for (const row of rows) {
      if (row.target === sourceId) return true;
      if (!visited.has(row.target)) {
        visited.add(row.target);
        next.push(row.target);
      }
    }
    frontier = next;
  }

  return false;
}

/**
 * Узел доступен, если все его prerequisite-предшественники в статусе
 * `mastered` или `automated`.
 */
export function computeLockedNodes(
  nodes: { id: string; status: string }[],
  edges: { source: string; target: string; relation: string }[],
): Set<string> {
  const statusById = new Map(nodes.map((n) => [n.id, n.status]));
  const locked = new Set<string>();

  for (const edge of edges) {
    if (edge.relation !== 'prerequisite') continue;
    const sourceStatus = statusById.get(edge.source);
    if (sourceStatus !== 'mastered' && sourceStatus !== 'automated') {
      locked.add(edge.target);
    }
  }

  return locked;
}
