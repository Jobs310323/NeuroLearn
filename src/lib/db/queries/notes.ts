import { and, arrayContains, asc, desc, eq, inArray, isNotNull, lte, or, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';

import { db } from '@/lib/db';
import { knowledgeNodes, noteLinks, notes, practiceSessions, sourceDocuments } from '@/lib/db/schema';
import type { Note, NoteRelation } from '@/lib/db/schema';
import { toTsQuery } from '@/lib/notes/search';
import type { ListNotesQuery } from '@/lib/validation/notes';

/**
 * Чтение тетради. Каждый запрос фильтрует `user_id` — это не оптимизация,
 * а граница владения: заметки читаются по многим срезам (узел, сессия,
 * источник), и ни один из них сам по себе не доказывает принадлежность.
 */

export type NoteListItem = {
  id: string;
  type: string;
  title: string | null;
  excerpt: string;
  colorLabel: string;
  tags: string[];
  nodeId: string | null;
  nodeTitle: string | null;
  sourceId: string | null;
  sourceTitle: string | null;
  pinned: boolean;
  isArchived: boolean;
  confusionFlag: boolean;
  resurfaceAt: string | null;
  resurfaceReason: string | null;
  hasCapsule: boolean;
  capsuleAnswered: boolean;
  aiProcessedAt: string | null;
  isConflictCopy: boolean;
  version: number;
  createdAt: string;
  updatedAt: string;
};

/** Первые строки текста для карточки списка — без разметки и без обрыва слова. */
export function buildExcerpt(contentMd: string, limit = 180): string {
  const flat = contentMd
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/[#>*_`~[\]()!-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (flat.length <= limit) return flat;
  const cut = flat.slice(0, limit);
  const lastSpace = cut.lastIndexOf(' ');
  return `${(lastSpace > limit * 0.6 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}

function toListItem(
  note: Note,
  nodeTitle: string | null,
  sourceTitle: string | null,
): NoteListItem {
  return {
    id: note.id,
    type: note.type,
    title: note.title,
    excerpt: buildExcerpt(note.contentMd),
    colorLabel: note.colorLabel,
    tags: note.tags,
    nodeId: note.nodeId,
    nodeTitle,
    sourceId: note.sourceId,
    sourceTitle,
    pinned: note.pinned,
    isArchived: note.isArchived,
    confusionFlag: note.confusionFlag,
    resurfaceAt: note.resurfaceAt?.toISOString() ?? null,
    resurfaceReason: note.resurfaceReason,
    hasCapsule: note.capsule !== null,
    capsuleAnswered: Boolean(note.capsule?.answeredAt),
    aiProcessedAt: note.aiProcessedAt?.toISOString() ?? null,
    isConflictCopy: note.conflictOfNoteId !== null,
    version: note.version,
    createdAt: note.createdAt.toISOString(),
    updatedAt: note.updatedAt.toISOString(),
  };
}

export async function listNotes(
  userId: string,
  query: ListNotesQuery,
  now = new Date(),
): Promise<{ items: NoteListItem[]; total: number }> {
  const conditions = [eq(notes.userId, userId), eq(notes.isArchived, query.archived)];

  if (query.type) conditions.push(eq(notes.type, query.type));
  if (query.color) conditions.push(eq(notes.colorLabel, query.color));
  if (query.tag) conditions.push(arrayContains(notes.tags, [query.tag]));
  if (query.nodeId) conditions.push(eq(notes.nodeId, query.nodeId));
  if (query.sessionId) conditions.push(eq(notes.sessionId, query.sessionId));
  if (query.sourceId) conditions.push(eq(notes.sourceId, query.sourceId));
  if (query.experimentId) conditions.push(eq(notes.experimentId, query.experimentId));
  if (query.confusion) conditions.push(eq(notes.confusionFlag, true));
  if (query.pinned) conditions.push(eq(notes.pinned, true));
  if (query.due) {
    conditions.push(isNotNull(notes.resurfaceAt), lte(notes.resurfaceAt, now));
  }

  const tsQuery = query.q ? toTsQuery(query.q) : null;
  if (tsQuery) {
    conditions.push(
      sql`to_tsvector('simple', coalesce(${notes.title}, '') || ' ' || ${notes.contentMd}) @@ to_tsquery('simple', ${tsQuery})`,
    );
  }

  const where = and(...conditions);

  const [rows, counted] = await Promise.all([
    db
      .select({ note: notes, nodeTitle: knowledgeNodes.title, sourceTitle: sourceDocuments.title })
      .from(notes)
      .leftJoin(knowledgeNodes, eq(knowledgeNodes.id, notes.nodeId))
      .leftJoin(sourceDocuments, eq(sourceDocuments.id, notes.sourceId))
      .where(where)
      // Закреплённые всегда сверху: человек закрепляет именно то, к чему
      // возвращается, и ранжирование по дате его бы прятало.
      .orderBy(desc(notes.pinned), desc(notes.updatedAt))
      .limit(query.limit)
      .offset(query.offset),
    db.select({ value: sql<number>`count(*)::int` }).from(notes).where(where),
  ]);

  return {
    items: rows.map((row) => toListItem(row.note, row.nodeTitle, row.sourceTitle)),
    total: counted[0]?.value ?? 0,
  };
}

export type NoteDetail = NoteListItem & {
  contentMd: string;
  sessionId: string | null;
  assessmentId: string | null;
  experimentId: string | null;
  parentNoteId: string | null;
  tutorConversationId: string | null;
  sourceAnchor: Note['sourceAnchor'];
  capsule: Note['capsule'];
  conflictOfNoteId: string | null;
  links: { noteId: string; title: string | null; relation: NoteRelation; direction: 'out' | 'in' }[];
};

export async function getNote(userId: string, noteId: string): Promise<NoteDetail | null> {
  const row = await db
    .select({ note: notes, nodeTitle: knowledgeNodes.title, sourceTitle: sourceDocuments.title })
    .from(notes)
    .leftJoin(knowledgeNodes, eq(knowledgeNodes.id, notes.nodeId))
    .leftJoin(sourceDocuments, eq(sourceDocuments.id, notes.sourceId))
    .where(and(eq(notes.id, noteId), eq(notes.userId, userId)))
    .limit(1);

  const found = row[0];
  if (!found) return null;

  const links = await listNoteLinks(userId, noteId);

  return {
    ...toListItem(found.note, found.nodeTitle, found.sourceTitle),
    contentMd: found.note.contentMd,
    sessionId: found.note.sessionId,
    assessmentId: found.note.assessmentId,
    experimentId: found.note.experimentId,
    parentNoteId: found.note.parentNoteId,
    tutorConversationId: found.note.tutorConversationId,
    sourceAnchor: found.note.sourceAnchor,
    capsule: found.note.capsule,
    conflictOfNoteId: found.note.conflictOfNoteId,
    links,
  };
}

/**
 * Связи в обе стороны одним запросом. Обратные ссылки — половина ценности
 * второго слоя: «что ссылается сюда» видно не реже, чем «куда ссылается это».
 */
export async function listNoteLinks(
  userId: string,
  noteId: string,
): Promise<NoteDetail['links']> {
  const fromNote = alias(notes, 'from_note');
  const toNote = alias(notes, 'to_note');

  const rows = await db
    .select({
      fromNoteId: noteLinks.fromNoteId,
      toNoteId: noteLinks.toNoteId,
      relation: noteLinks.relation,
      fromTitle: fromNote.title,
      toTitle: toNote.title,
    })
    .from(noteLinks)
    .innerJoin(fromNote, eq(fromNote.id, noteLinks.fromNoteId))
    .innerJoin(toNote, eq(toNote.id, noteLinks.toNoteId))
    .where(
      and(
        eq(noteLinks.userId, userId),
        or(eq(noteLinks.fromNoteId, noteId), eq(noteLinks.toNoteId, noteId)),
      ),
    )
    .orderBy(asc(noteLinks.createdAt));

  return rows.map((row) =>
    row.fromNoteId === noteId
      ? { noteId: row.toNoteId, title: row.toTitle, relation: row.relation, direction: 'out' as const }
      : { noteId: row.fromNoteId, title: row.fromTitle, relation: row.relation, direction: 'in' as const },
  );
}

/**
 * Счётчики заметок по узлам пути — для слоя «Заметки» на карте знаний.
 * Отдельный лёгкий запрос: карте нужны числа, а не тексты.
 */
export async function countNotesByNode(
  userId: string,
  nodeIds: string[],
): Promise<Map<string, { total: number; due: number; confusion: number }>> {
  const result = new Map<string, { total: number; due: number; confusion: number }>();
  if (nodeIds.length === 0) return result;

  const rows = await db
    .select({
      nodeId: notes.nodeId,
      total: sql<number>`count(*)::int`,
      due: sql<number>`count(*) filter (where ${notes.resurfaceAt} is not null and ${notes.resurfaceAt} <= now())::int`,
      confusion: sql<number>`count(*) filter (where ${notes.confusionFlag})::int`,
    })
    .from(notes)
    .where(
      and(
        eq(notes.userId, userId),
        eq(notes.isArchived, false),
        inArray(notes.nodeId, nodeIds),
      ),
    )
    .groupBy(notes.nodeId);

  for (const row of rows) {
    if (row.nodeId) {
      result.set(row.nodeId, { total: row.total, due: row.due, confusion: row.confusion });
    }
  }
  return result;
}

/** Заголовок сессии для префилла заметки-рефлексии. */
export async function getSessionAnchor(
  userId: string,
  sessionId: string,
): Promise<{ id: string; primaryNodeId: string | null; score: number | null } | null> {
  const row = await db.query.practiceSessions.findFirst({
    where: and(eq(practiceSessions.id, sessionId), eq(practiceSessions.userId, userId)),
    columns: { id: true, primaryNodeId: true, score: true },
  });
  return row ?? null;
}
