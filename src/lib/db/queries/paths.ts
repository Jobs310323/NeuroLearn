import { and, asc, desc, eq, inArray } from 'drizzle-orm';

import { db } from '@/lib/db';
import {
  fsrsCards,
  knowledgeNodes,
  learningPaths,
  nodeEdges,
  nodeProgress,
} from '@/lib/db/schema';
import { computeLockedNodes } from '@/lib/services/graph/acyclic';

export type PathSummary = {
  id: string;
  title: string;
  goal: string;
  status: string;
  nodeCount: number;
  masteredCount: number;
  automatedCount: number;
  updatedAt: Date;
};

export async function listPaths(userId: string): Promise<PathSummary[]> {
  const paths = await db
    .select()
    .from(learningPaths)
    .where(eq(learningPaths.userId, userId))
    .orderBy(desc(learningPaths.updatedAt));

  if (paths.length === 0) return [];

  const nodes = await db
    .select({ pathId: knowledgeNodes.pathId, status: knowledgeNodes.status })
    .from(knowledgeNodes)
    .where(
      inArray(
        knowledgeNodes.pathId,
        paths.map((p) => p.id),
      ),
    );

  return paths.map((path) => {
    const own = nodes.filter((n) => n.pathId === path.id);
    return {
      id: path.id,
      title: path.title,
      goal: path.goal,
      status: path.status,
      nodeCount: own.length,
      masteredCount: own.filter((n) => n.status === 'mastered').length,
      automatedCount: own.filter((n) => n.status === 'automated').length,
      updatedAt: path.updatedAt,
    };
  });
}

export type GraphNode = {
  id: string;
  parentId: string | null;
  title: string;
  description: string | null;
  status: string;
  depth: number;
  orderIndex: number;
  weight: number;
  difficulty: number;
  contentReady: boolean;
  estimatedMinutes: number;
  position: { x: number; y: number };
  progress: {
    knowledgeStrength: number;
    automaticityIndex: number;
    timeToMasterySeconds: number | null;
  };
  review: { due: string; state: string } | null;
  locked: boolean;
};

export type GraphEdge = {
  source: string;
  target: string;
  relation: string;
  strength: number;
};

export type PathGraph = {
  path: {
    id: string;
    title: string;
    goal: string;
    status: string;
    description: string | null;
    targetLevel: string | null;
  };
  nodes: GraphNode[];
  edges: GraphEdge[];
  stats: {
    total: number;
    mastered: number;
    automated: number;
    needsReview: number;
    hasGaps: number;
  };
};

/**
 * Полный срез пути для карты знаний. Один вызов — вся страница:
 * узлы, рёбра, прогресс, ближайшие повторения и блокировки по зависимостям.
 */
export async function getPathGraph(
  userId: string,
  pathId: string,
): Promise<PathGraph | null> {
  const path = await db.query.learningPaths.findFirst({
    where: and(eq(learningPaths.id, pathId), eq(learningPaths.userId, userId)),
  });
  if (!path) return null;

  const nodes = await db
    .select()
    .from(knowledgeNodes)
    .where(eq(knowledgeNodes.pathId, pathId))
    .orderBy(asc(knowledgeNodes.depth), asc(knowledgeNodes.orderIndex));

  const nodeIds = nodes.map((n) => n.id);

  const [progressRows, edgeRows, cardRows] =
    nodeIds.length === 0
      ? [[], [], []]
      : await Promise.all([
          db.select().from(nodeProgress).where(inArray(nodeProgress.nodeId, nodeIds)),
          db.select().from(nodeEdges).where(inArray(nodeEdges.sourceId, nodeIds)),
          db
            .select()
            .from(fsrsCards)
            .where(and(eq(fsrsCards.userId, userId), inArray(fsrsCards.nodeId, nodeIds))),
        ]);

  const progressByNode = new Map(progressRows.map((p) => [p.nodeId, p]));
  const cardByNode = new Map(cardRows.map((c) => [c.nodeId, c]));

  const edges: GraphEdge[] = edgeRows.map((e) => ({
    source: e.sourceId,
    target: e.targetId,
    relation: e.relation,
    strength: e.strength,
  }));

  const locked = computeLockedNodes(
    nodes.map((n) => ({ id: n.id, status: n.status })),
    edges,
  );

  return {
    path: {
      id: path.id,
      title: path.title,
      goal: path.goal,
      status: path.status,
      description: path.description,
      targetLevel: path.targetLevel,
    },
    nodes: nodes.map((n) => {
      const progress = progressByNode.get(n.id);
      const card = cardByNode.get(n.id);
      return {
        id: n.id,
        parentId: n.parentId,
        title: n.title,
        description: n.description,
        status: n.status,
        depth: n.depth,
        orderIndex: n.orderIndex,
        weight: n.weight,
        difficulty: n.difficulty,
        contentReady: n.contentReady,
        estimatedMinutes: n.estimatedMinutes,
        position: { x: n.posX, y: n.posY },
        progress: {
          knowledgeStrength: progress?.knowledgeStrength ?? 0,
          automaticityIndex: progress?.automaticityIndex ?? 0,
          timeToMasterySeconds: progress?.timeToMasterySeconds ?? null,
        },
        review: card ? { due: card.due.toISOString(), state: card.state } : null,
        locked: locked.has(n.id),
      };
    }),
    edges,
    stats: {
      total: nodes.length,
      mastered: nodes.filter((n) => n.status === 'mastered').length,
      automated: nodes.filter((n) => n.status === 'automated').length,
      needsReview: nodes.filter((n) => n.status === 'needs_review').length,
      hasGaps: nodes.filter((n) => n.status === 'has_gaps').length,
    },
  };
}
