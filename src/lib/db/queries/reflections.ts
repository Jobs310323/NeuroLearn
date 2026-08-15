import { desc, eq } from 'drizzle-orm';

import { db } from '@/lib/db';
import { knowledgeNodes, reflections } from '@/lib/db/schema';

export type ReflectionListItem = {
  id: string;
  type: string;
  nodeId: string | null;
  nodeTitle: string | null;
  body: string;
  wordCount: number;
  depthScore: number | null;
  calibrationDelta: number | null;
  createdAt: string;
};

export async function getReflections(userId: string, limit = 20): Promise<ReflectionListItem[]> {
  const rows = await db
    .select({
      id: reflections.id,
      type: reflections.type,
      nodeId: reflections.nodeId,
      nodeTitle: knowledgeNodes.title,
      body: reflections.body,
      wordCount: reflections.wordCount,
      depthScore: reflections.depthScore,
      calibrationDelta: reflections.calibrationDelta,
      createdAt: reflections.createdAt,
    })
    .from(reflections)
    .leftJoin(knowledgeNodes, eq(knowledgeNodes.id, reflections.nodeId))
    .where(eq(reflections.userId, userId))
    .orderBy(desc(reflections.createdAt))
    .limit(limit);

  return rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() }));
}
