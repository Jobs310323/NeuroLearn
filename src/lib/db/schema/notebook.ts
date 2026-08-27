import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';

import { tutorConversations } from './agents';
import { assessments } from './content';
import { learningExperiments } from './experiments';
import { knowledgeNodes } from './learning';
import { practiceSessions } from './practice';
import { sourceDocuments } from './sources';
import { users } from './users';
import type { NoteCapsule, NoteSourceAnchor } from './types';

/**
 * Рабочая тетрадь — второй слой карты знаний.
 *
 * Ключевое отличие от «заметок рядом»: заметка не висит в воздухе, а
 * заякорена на объект обучения (узел, сессия, задание, эксперимент,
 * источник). Из-за этого её можно вернуть человеку в нужный момент — когда
 * знание под ней проседает, — а не надеяться, что он сам вспомнит перечитать.
 *
 * Практика строит навык, тетрадь строит понимание. Поэтому здесь нет ни
 * оценок, ни счётчиков достижений: количество заметок ничего не значит.
 */

export const noteTypeEnum = pgEnum('note_type', [
  /** Быстрый перехват мысли откуда угодно; тип по умолчанию. */
  'capture',
  'summary',
  'idea',
  /** Создаётся после сессии с префиллом фактических метрик. */
  'reflection',
  'question',
  'quote',
  /** Связка двух узлов: чем они похожи и чем различаются. */
  'link_note',
]);

/**
 * Типы отношений между заметками. Двудольность графа («узлы» и «заметки»)
 * задаётся якорями, а эти рёбра — второй слой уже внутри тетради.
 */
export const noteRelationEnum = pgEnum('note_relation', [
  'supports',
  'contradicts',
  'extends',
  'question_of',
  'example_of',
]);

/**
 * Цветовая метка. Строго семантическая и из токенов оформления: цвет в
 * продукте несёт данные, декоративной раскраски нет (инвариант проекта).
 */
export const noteColorEnum = pgEnum('note_color', [
  'neutral',
  'insight',
  'question',
  'gap',
  'source',
  'contradiction',
]);

export const notes = pgTable(
  'notes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    type: noteTypeEnum('type').notNull().default('capture'),
    title: text('title'),
    contentMd: text('content_md').notNull().default(''),
    colorLabel: noteColorEnum('color_label').notNull().default('neutral'),
    tags: text('tags').array().notNull().default(sql`'{}'::text[]`),

    // --- Якоря. Все необязательны, но заметка почти всегда имеет хотя бы один.
    nodeId: uuid('node_id').references(() => knowledgeNodes.id, { onDelete: 'set null' }),
    sessionId: uuid('session_id').references(() => practiceSessions.id, {
      onDelete: 'set null',
    }),
    /**
     * Якорь на задание. В плане поле названо `task_id`, в схеме проекта
     * задания живут в `assessments` — выигрывает имя репозитория, иначе
     * пришлось бы держать в голове два названия одной сущности.
     */
    assessmentId: uuid('assessment_id').references(() => assessments.id, {
      onDelete: 'set null',
    }),
    experimentId: uuid('experiment_id').references(() => learningExperiments.id, {
      onDelete: 'set null',
    }),
    sourceId: uuid('source_id').references(() => sourceDocuments.id, {
      onDelete: 'set null',
    }),
    /** Диапазон страниц/времени внутри источника — «с. 42–44», «12:30–13:10». */
    sourceAnchor: jsonb('source_anchor').$type<NoteSourceAnchor | null>(),

    parentNoteId: uuid('parent_note_id').references((): AnyPgColumn => notes.id, {
      onDelete: 'set null',
    }),

    /**
     * Когда заметка сама вернётся к человеку. Заполняется двумя источниками:
     * капсулой времени (человек назначил дату) и планировщиком живых заметок
     * (знание под заметкой просело). Планировщик полностью детерминированный.
     */
    resurfaceAt: timestamp('resurface_at', { withTimezone: true }),
    /** Почему заметка вернулась — показывается человеку, а не только логике. */
    resurfaceReason: text('resurface_reason'),
    /**
     * Капсула времени: предсказание + ответ «сбылось ли». Ответ — точка данных
     * калибровки, поэтому хранится вместе с исходной уверенностью, а не
     * отдельно: без пары «что думал / как вышло» число бессмысленно.
     */
    capsule: jsonb('capsule').$type<NoteCapsule | null>(),

    /**
     * Флаг «не понял» из практики. Отдельная колонка, а не тег: по ней
     * строится реестр непонимания и недельный разбор, и она обязана быть
     * индексируемой и не зависеть от того, как человек назвал тег.
     */
    confusionFlag: boolean('confusion_flag').notNull().default(false),
    /** Вопрос ушёл в очередь асинхронного сократического тьютора. */
    tutorConversationId: uuid('tutor_conversation_id').references(
      () => tutorConversations.id,
      { onDelete: 'set null' },
    ),

    pinned: boolean('pinned').notNull().default(false),
    isArchived: boolean('is_archived').notNull().default(false),

    /**
     * Когда по заметке в последний раз отработал AI (авто-теги, суммаризация,
     * детектор противоречий). Показывается бейджем: человек всегда видит,
     * трогала ли модель его текст. По умолчанию AI по заметкам выключен.
     */
    aiProcessedAt: timestamp('ai_processed_at', { withTimezone: true }),

    /**
     * Оптимистическая блокировка. Тетрадь правится и офлайн, и с другого
     * устройства; молча перетереть чужую версию нельзя — сервер отвечает 409
     * со своей версией, клиент сохраняет ОБЕ копии.
     */
    version: integer('version').notNull().default(1),
    /**
     * Заполнено — это конфликтная копия, созданная при расхождении версий.
     * Текст человека не теряется никогда, даже ценой лишней строки.
     */
    conflictOfNoteId: uuid('conflict_of_note_id').references((): AnyPgColumn => notes.id, {
      onDelete: 'set null',
    }),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('notes_user_updated_idx').on(t.userId, t.updatedAt.desc()),
    index('notes_user_node_idx').on(t.userId, t.nodeId),
    index('notes_user_type_idx').on(t.userId, t.type),
    index('notes_resurface_idx').on(t.resurfaceAt).where(sql`${t.resurfaceAt} IS NOT NULL`),
    index('notes_confusion_idx')
      .on(t.userId, t.createdAt)
      .where(sql`${t.confusionFlag} = true`),
    /**
     * Полнотекстовый поиск. Конфигурация `simple`, а не `russian`: тетрадь
     * многоязычна с первого релиза (ru/en/es), а одна языковая конфигурация
     * стеммит чужие языки заведомо неверно. `simple` не стеммит вовсе — это
     * честная потеря словоформ вместо неверных совпадений. Семантический
     * поиск придёт отдельным слоем (pgvector, Фаза W8) и стемминг не заменяет.
     */
    index('notes_fts_idx').using(
      'gin',
      sql`to_tsvector('simple', coalesce(${t.title}, '') || ' ' || ${t.contentMd})`,
    ),
    check('notes_version_positive', sql`${t.version} >= 1`),
    check('notes_no_self_parent', sql`${t.parentNoteId} IS DISTINCT FROM ${t.id}`),
    check('notes_no_self_conflict', sql`${t.conflictOfNoteId} IS DISTINCT FROM ${t.id}`),
  ],
);

/**
 * Типизированные связи между заметками. Пара уникальна по отношению: одна и
 * та же заметка может и «дополнять», и «противоречить» другой — это разные
 * утверждения, а не дубль.
 */
export const noteLinks = pgTable(
  'note_links',
  {
    fromNoteId: uuid('from_note_id')
      .notNull()
      .references(() => notes.id, { onDelete: 'cascade' }),
    toNoteId: uuid('to_note_id')
      .notNull()
      .references(() => notes.id, { onDelete: 'cascade' }),
    relation: noteRelationEnum('relation').notNull(),
    /** Денормализовано: любой запрос к тетради фильтрует по пользователю. */
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.fromNoteId, t.toNoteId, t.relation] }),
    index('note_links_to_idx').on(t.toNoteId, t.relation),
    index('note_links_user_idx').on(t.userId),
    check('note_links_no_self_loop', sql`${t.fromNoteId} <> ${t.toNoteId}`),
  ],
);

export type Note = typeof notes.$inferSelect;
export type NewNote = typeof notes.$inferInsert;
export type NoteLink = typeof noteLinks.$inferSelect;
export type NewNoteLink = typeof noteLinks.$inferInsert;
export type NoteType = (typeof noteTypeEnum.enumValues)[number];
export type NoteRelation = (typeof noteRelationEnum.enumValues)[number];
export type NoteColor = (typeof noteColorEnum.enumValues)[number];

/**
 * Векторы заметок для семантического поиска (Фаза W8).
 *
 * Размерность 384, а не 1536 из эскиза плана. Причина в том, КТО считает
 * вектор: не платный embedding-API, а локальная модель в браузере
 * (`@xenova/transformers`, та же библиотека, что уже расшифровывает аудио —
 * `features/sources/audio-transcriber.worker.ts`). Тетрадь при этом остаётся
 * работоспособной при нулевом лимите провайдеров, а самый личный текст в
 * приложении не уезжает наружу ради поиска.
 *
 * `contentHash` отвечает на вопрос «вектор устарел?»: пересчитывать эмбеддинг
 * на каждое сохранение — впустую жечь время и батарею человека.
 *
 * Таблица создаётся только если в базе есть расширение `vector`. Его
 * отсутствие — не ошибка: поиск честно деградирует в полнотекстовый, и это
 * видно в ответе API (`degraded`), а не только в логах.
 */
export const noteEmbeddings = pgTable(
  'note_embeddings',
  {
    noteId: uuid('note_id')
      .primaryKey()
      .references(() => notes.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    contentHash: text('content_hash').notNull(),
    /** Имя модели — векторы разных моделей несопоставимы между собой. */
    model: text('model').notNull(),
    /** Хранится как массив чисел: тип `vector` объявляется SQL-миграцией. */
    embedding: doublePrecision('embedding').array().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('note_embeddings_user_idx').on(t.userId)],
);

export type NoteEmbedding = typeof noteEmbeddings.$inferSelect;
