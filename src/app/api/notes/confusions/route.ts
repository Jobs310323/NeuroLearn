import { and, desc, eq, gte } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { z } from 'zod';

import { unauthorized, validationFailed } from '@/lib/api/respond';
import { requireUserIdOrThrow } from '@/lib/auth/require-user';
import { db } from '@/lib/db';
import { knowledgeNodes, notes } from '@/lib/db/schema';
import { clusterConfusions } from '@/lib/services/notes/pipelines';

/**
 * Реестр непонимания: что было помечено «не понял» и на каких темах это
 * повторяется.
 *
 * Группировка по узлу, а не по дате — три пометки на одном узле за неделю
 * значат совсем не то же, что три пометки на трёх разных. Первое — тема,
 * которая не даётся, второе — обычный ход обучения.
 *
 * Никакого AI: кластеризация здесь — это `GROUP BY`, и называть её иначе
 * было бы преувеличением.
 */
const querySchema = z.object({
  days: z.coerce.number().int().min(1).max(90).default(7),
});

export async function GET(request: Request): Promise<Response> {
  let userId: string;
  try {
    userId = await requireUserIdOrThrow();
  } catch (error) {
    return unauthorized(error);
  }

  const url = new URL(request.url);
  const parsed = querySchema.safeParse(Object.fromEntries(url.searchParams));
  if (!parsed.success) return validationFailed(parsed.error);

  const since = new Date(Date.now() - parsed.data.days * 86_400_000);

  const rows = await db
    .select({
      noteId: notes.id,
      title: notes.title,
      nodeId: notes.nodeId,
      nodeTitle: knowledgeNodes.title,
      createdAt: notes.createdAt,
    })
    .from(notes)
    .leftJoin(knowledgeNodes, eq(knowledgeNodes.id, notes.nodeId))
    .where(
      and(
        eq(notes.userId, userId),
        eq(notes.confusionFlag, true),
        eq(notes.isArchived, false),
        gte(notes.createdAt, since),
      ),
    )
    .orderBy(desc(notes.createdAt));

  return NextResponse.json({
    days: parsed.data.days,
    total: rows.length,
    clusters: clusterConfusions(rows).map((cluster) => ({
      ...cluster,
      entries: cluster.entries.map((entry) => ({
        ...entry,
        createdAt: entry.createdAt.toISOString(),
      })),
    })),
  });
}
