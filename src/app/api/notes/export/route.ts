import { asc, eq } from 'drizzle-orm';

import { unauthorized } from '@/lib/api/respond';
import { requireUserIdOrThrow } from '@/lib/auth/require-user';
import { db } from '@/lib/db';
import { knowledgeNodes, noteLinks, notes, sourceDocuments } from '@/lib/db/schema';
import {
  buildIndexFile,
  safeFileName,
  toMarkdownFile,
  type ExportableNote,
} from '@/lib/notes/export';
import { createZip, type ZipEntry } from '@/lib/notes/zip';

/**
 * Выгрузка всей тетради архивом `.md`-файлов с front-matter в формате
 * Obsidian.
 *
 * Право унести свои записи целиком — не фича, а условие доверия к продукту,
 * которому эти записи отдают. Поэтому выгрузка не зависит ни от AI, ни от
 * состояния провайдеров: только база и чистые сериализаторы.
 *
 * Архив собирается в памяти. Тетрадь одного человека — текст, а не медиа;
 * потоковая сборка усложнила бы код ради объёмов, которых здесь не бывает.
 */
export async function GET(): Promise<Response> {
  let userId: string;
  try {
    userId = await requireUserIdOrThrow();
  } catch (error) {
    return unauthorized(error);
  }

  const rows = await db
    .select({ note: notes, nodeTitle: knowledgeNodes.title, sourceTitle: sourceDocuments.title })
    .from(notes)
    .leftJoin(knowledgeNodes, eq(knowledgeNodes.id, notes.nodeId))
    .leftJoin(sourceDocuments, eq(sourceDocuments.id, notes.sourceId))
    .where(eq(notes.userId, userId))
    .orderBy(asc(notes.createdAt));

  const links = await db
    .select({
      fromNoteId: noteLinks.fromNoteId,
      toNoteId: noteLinks.toNoteId,
      relation: noteLinks.relation,
    })
    .from(noteLinks)
    .where(eq(noteLinks.userId, userId));

  const titleById = new Map(rows.map((row) => [row.note.id, row.note.title]));

  const exportable: ExportableNote[] = rows.map((row) => ({
    id: row.note.id,
    type: row.note.type,
    title: row.note.title,
    contentMd: row.note.contentMd,
    colorLabel: row.note.colorLabel,
    tags: row.note.tags,
    nodeTitle: row.nodeTitle,
    sourceTitle: row.sourceTitle,
    pinned: row.note.pinned,
    resurfaceAt: row.note.resurfaceAt?.toISOString() ?? null,
    createdAt: row.note.createdAt.toISOString(),
    updatedAt: row.note.updatedAt.toISOString(),
    links: links
      .filter((link) => link.fromNoteId === row.note.id || link.toNoteId === row.note.id)
      .map((link) =>
        link.fromNoteId === row.note.id
          ? {
              title: titleById.get(link.toNoteId) ?? null,
              relation: link.relation,
              direction: 'out' as const,
            }
          : {
              title: titleById.get(link.fromNoteId) ?? null,
              relation: link.relation,
              direction: 'in' as const,
            },
      ),
  }));

  const now = new Date();
  const entries: ZipEntry[] = [
    { name: 'Тетрадь.md', content: buildIndexFile(exportable, now) },
    ...exportable.map((note) => ({
      name: `notes/${safeFileName(note)}`,
      content: toMarkdownFile(note),
    })),
  ];

  const archive = createZip(entries, now);
  const stamp = now.toISOString().slice(0, 10);

  return new Response(archive as unknown as BodyInit, {
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="neurolearn-notebook-${stamp}.zip"`,
      'Content-Length': String(archive.length),
      'Cache-Control': 'no-store',
    },
  });
}

/** Выгрузка всегда собирается заново: кэшировать снимок чужих правок нельзя. */
export const dynamic = 'force-dynamic';
