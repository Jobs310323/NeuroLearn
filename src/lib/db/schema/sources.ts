import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  real,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';

import { knowledgeNodes, learningPaths } from './learning';
import { users } from './users';

/**
 * Импорт собственных материалов: конспекты от других ИИ, книги, PDF.
 * Файлы не хранятся — извлекается текст, оригинал отбрасывается.
 * Поиск по источникам — полнотекстовый (GIN-индекс по `to_tsvector`),
 * без векторов и без платных embedding-API.
 */
export const sourceKindEnum = pgEnum('source_kind', [
  'pdf',
  'markdown',
  'plain_text',
  'ai_notes',
  'url',
  'epub',
]);

export const sourceStatusEnum = pgEnum('source_status', [
  'uploaded',
  'extracting',
  'ready',
  'failed',
]);

export const sourceDocuments = pgTable(
  'source_documents',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** Источник можно привязать к пути — тогда генератор берёт его как основу. */
    pathId: uuid('path_id').references(() => learningPaths.id, { onDelete: 'set null' }),
    title: text('title').notNull(),
    kind: sourceKindEnum('kind').notNull(),
    status: sourceStatusEnum('status').notNull().default('uploaded'),
    originalFilename: text('original_filename'),
    sourceUrl: text('source_url'),
    author: text('author'),
    charCount: integer('char_count').notNull().default(0),
    chunkCount: integer('chunk_count').notNull().default(0),
    failureReason: text('failure_reason'),
    meta: jsonb('meta').$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('source_documents_user_idx').on(t.userId, t.createdAt)],
);

/**
 * Фрагмент источника. Единица цитирования: сгенерированный блок или задание
 * ссылается на конкретный фрагмент, чтобы можно было проверить основание.
 */
export const sourceChunks = pgTable(
  'source_chunks',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    documentId: uuid('document_id')
      .notNull()
      .references(() => sourceDocuments.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    orderIndex: integer('order_index').notNull(),
    /** Путь заголовков до фрагмента: ['Глава 3', 'Синапсы']. */
    headingPath: jsonb('heading_path').$type<string[]>().notNull().default([]),
    content: text('content').notNull(),
    charCount: integer('char_count').notNull(),
    /** Номер страницы для PDF — для ссылки «источник: с. 42». */
    pageNumber: integer('page_number'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('source_chunks_document_idx').on(t.documentId, t.orderIndex),
    index('source_chunks_user_idx').on(t.userId),
    check('source_chunks_content_not_empty', sql`length(btrim(${t.content})) > 0`),
  ],
);

/**
 * Провенанс: какой фрагмент источника лёг в основу узла.
 * Позволяет показать «на чём основан этот материал» и не выдумывать факты.
 */
export const nodeSources = pgTable(
  'node_sources',
  {
    nodeId: uuid('node_id')
      .notNull()
      .references(() => knowledgeNodes.id, { onDelete: 'cascade' }),
    chunkId: uuid('chunk_id')
      .notNull()
      .references(() => sourceChunks.id, { onDelete: 'cascade' }),
    /** Насколько фрагмент релевантен узлу, 0..1 (оценка при подборе). */
    relevance: real('relevance').notNull().default(0.5),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('node_sources_node_idx').on(t.nodeId),
    index('node_sources_chunk_idx').on(t.chunkId),
  ],
);

export type SourceDocument = typeof sourceDocuments.$inferSelect;
export type NewSourceDocument = typeof sourceDocuments.$inferInsert;
export type SourceChunk = typeof sourceChunks.$inferSelect;
export type NewSourceChunk = typeof sourceChunks.$inferInsert;
