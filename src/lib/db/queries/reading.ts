import { asc, eq } from 'drizzle-orm';

import { db } from '@/lib/db';
import { contentBlocks, knowledgeNodes, learningPaths } from '@/lib/db/schema';
import type { ContentBlock } from '@/lib/db/schema/content';
import type { ContentPayload } from '@/lib/db/schema/types';

type ContentBlockType = ContentBlock['type'];

export type ReadingBlock = {
  id: string;
  type: ContentBlockType;
  title: string;
  orderIndex: number;
  payload: ContentPayload;
  scienceCitationKey: string | null;
};

export type NodeReadingMaterial = {
  node: {
    id: string;
    title: string;
    description: string | null;
    pathId: string;
    pathTitle: string;
  };
  blocks: ReadingBlock[];
};

/**
 * Материал узла для чтения. `null`, если узла нет, он принадлежит не этому
 * пользователю или материал ещё не сгенерирован — все три случая для вызывающей
 * стороны неотличимы (`notFound()`), чтобы не палить владельцам чужих узлов их
 * существование через разные ответы.
 */
export async function getNodeReadingMaterial(
  userId: string,
  nodeId: string,
): Promise<NodeReadingMaterial | null> {
  const rows = await db
    .select({
      nodeId: knowledgeNodes.id,
      title: knowledgeNodes.title,
      description: knowledgeNodes.description,
      contentReady: knowledgeNodes.contentReady,
      pathId: knowledgeNodes.pathId,
      pathTitle: learningPaths.title,
      ownerId: learningPaths.userId,
    })
    .from(knowledgeNodes)
    .innerJoin(learningPaths, eq(learningPaths.id, knowledgeNodes.pathId))
    .where(eq(knowledgeNodes.id, nodeId))
    .limit(1);

  const found = rows[0];
  if (!found || found.ownerId !== userId || !found.contentReady) return null;

  const blocks = await db
    .select({
      id: contentBlocks.id,
      type: contentBlocks.type,
      title: contentBlocks.title,
      orderIndex: contentBlocks.orderIndex,
      payload: contentBlocks.payload,
      scienceCitationKey: contentBlocks.scienceCitationKey,
    })
    .from(contentBlocks)
    .where(eq(contentBlocks.nodeId, nodeId))
    .orderBy(asc(contentBlocks.orderIndex));

  return {
    node: {
      id: found.nodeId,
      title: found.title,
      description: found.description,
      pathId: found.pathId,
      pathTitle: found.pathTitle,
    },
    blocks,
  };
}
