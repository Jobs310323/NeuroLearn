import { desc, eq } from 'drizzle-orm';

import { db } from '@/lib/db';
import { learningPaths, sourceDocuments } from '@/lib/db/schema';

export type SourceSummary = {
  id: string;
  title: string;
  kind: string;
  status: string;
  pathId: string | null;
  pathTitle: string | null;
  originalFilename: string | null;
  charCount: number;
  chunkCount: number;
  failureReason: string | null;
  createdAt: Date;
};

export async function listSources(userId: string): Promise<SourceSummary[]> {
  const rows = await db
    .select({
      id: sourceDocuments.id,
      title: sourceDocuments.title,
      kind: sourceDocuments.kind,
      status: sourceDocuments.status,
      pathId: sourceDocuments.pathId,
      pathTitle: learningPaths.title,
      originalFilename: sourceDocuments.originalFilename,
      charCount: sourceDocuments.charCount,
      chunkCount: sourceDocuments.chunkCount,
      failureReason: sourceDocuments.failureReason,
      createdAt: sourceDocuments.createdAt,
    })
    .from(sourceDocuments)
    .leftJoin(learningPaths, eq(learningPaths.id, sourceDocuments.pathId))
    .where(eq(sourceDocuments.userId, userId))
    .orderBy(desc(sourceDocuments.createdAt));

  return rows;
}
