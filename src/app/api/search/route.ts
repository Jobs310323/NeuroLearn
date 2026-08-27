import { and, eq, ilike, or, sql } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { z } from 'zod';

import { unauthorized, validationFailed } from '@/lib/api/respond';
import { requireUserIdOrThrow } from '@/lib/auth/require-user';
import { db } from '@/lib/db';
import { knowledgeNodes, learningPaths, notes } from '@/lib/db/schema';
import { buildExcerpt } from '@/lib/db/queries/notes';
import { toTsQuery } from '@/lib/notes/search';

/**
 * Общий поиск для командной палитры: заметки и узлы знаний.
 *
 * Детерминированный, без модели. По заметкам — полнотекстовый индекс, по
 * узлам — совпадение по названию: узлов у человека сотни, а не десятки тысяч,
 * и заводить ради них второй GIN-индекс было бы преждевременно.
 *
 * Оба запроса фильтруют пользователя: палитра ищет по личным данным, и
 * граница владения здесь такая же, как везде.
 */

const querySchema = z.object({
  q: z.string().trim().min(1).max(200),
  limit: z.coerce.number().int().min(1).max(20).default(8),
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

  const { q, limit } = parsed.data;
  const tsQuery = toTsQuery(q);

  const [noteRows, nodeRows] = await Promise.all([
    tsQuery
      ? db
          .select({ id: notes.id, title: notes.title, contentMd: notes.contentMd })
          .from(notes)
          .where(
            and(
              eq(notes.userId, userId),
              eq(notes.isArchived, false),
              sql`to_tsvector('simple', coalesce(${notes.title}, '') || ' ' || ${notes.contentMd}) @@ to_tsquery('simple', ${tsQuery})`,
            ),
          )
          .limit(limit)
      : Promise.resolve([]),
    db
      .select({
        id: knowledgeNodes.id,
        title: knowledgeNodes.title,
        pathId: knowledgeNodes.pathId,
        pathTitle: learningPaths.title,
      })
      .from(knowledgeNodes)
      .innerJoin(learningPaths, eq(learningPaths.id, knowledgeNodes.pathId))
      .where(
        and(
          eq(learningPaths.userId, userId),
          or(
            ilike(knowledgeNodes.title, `%${q}%`),
            ilike(knowledgeNodes.description, `%${q}%`),
          ),
        ),
      )
      .limit(limit),
  ]);

  return NextResponse.json({
    hits: [
      ...noteRows.map((row) => ({
        id: row.id,
        kind: 'note' as const,
        label: row.title ?? buildExcerpt(row.contentMd, 60) ?? 'Без названия',
        hint: 'заметка',
        href: `/notes?note=${row.id}`,
      })),
      ...nodeRows.map((row) => ({
        id: row.id,
        kind: 'node' as const,
        label: row.title,
        hint: row.pathTitle,
        href: `/paths/${row.pathId}`,
      })),
    ],
  });
}
