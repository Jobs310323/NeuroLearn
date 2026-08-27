import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  real,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';

import { nodeRelationEnum, nodeStatusEnum, pathStatusEnum } from './enums';
import { users } from './users';

/** Направление обучения. Всегда принадлежит одному пользователю. */
export const learningPaths = pgTable(
  'learning_paths',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    /** Формулировка цели пользователя — вход для ContentGenerator. */
    goal: text('goal').notNull(),
    description: text('description'),
    /** Целевой уровень: «уверенный джун», «пройти собес в X» и т.п. */
    targetLevel: text('target_level'),
    estimatedHours: integer('estimated_hours'),
    status: pathStatusEnum('status').notNull().default('draft'),
    /** Снимок промпта/модели, которыми сгенерировано дерево (воспроизводимость). */
    generationMeta: jsonb('generation_meta').$type<{
      model: string;
      promptVersion: string;
      generatedAt: string;
    } | null>(),
    /**
     * Версия раскладки карты. Оптимистическая блокировка на уровне пути, а не
     * узла: «Упорядочить» переписывает координаты всех узлов сразу, и
     * конфликтует именно раскладка целиком. Ручное перетаскивание одного узла
     * тоже двигает версию — иначе оно молча терялось бы под чужим
     * «Упорядочить», выполненным на другом устройстве.
     */
    layoutVersion: integer('layout_version').notNull().default(1),
    /** Каким режимом группировки разложена карта — чтобы кнопка помнила выбор. */
    layoutGrouping: text('layout_grouping').notNull().default('bloom'),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('learning_paths_user_status_idx').on(t.userId, t.status)],
);

/**
 * Узел дерева знаний.
 * `parentId` задаёт дерево для навигации, `nodeEdges` — DAG зависимостей поверх него.
 */
export const knowledgeNodes = pgTable(
  'knowledge_nodes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    pathId: uuid('path_id')
      .notNull()
      .references(() => learningPaths.id, { onDelete: 'cascade' }),
    parentId: uuid('parent_id').references((): AnyPgColumn => knowledgeNodes.id, {
      onDelete: 'cascade',
    }),
    slug: text('slug').notNull(),
    title: text('title').notNull(),
    description: text('description'),
    depth: integer('depth').notNull().default(0),
    orderIndex: integer('order_index').notNull().default(0),
    /** Важность узла для цели пути, 0..1. Влияет на приоритет очереди повторений. */
    weight: real('weight').notNull().default(0.5),
    /** Априорная сложность от ContentGenerator, 0..1. */
    difficulty: real('difficulty').notNull().default(0.5),
    status: nodeStatusEnum('status').notNull().default('not_started'),
    estimatedMinutes: integer('estimated_minutes').notNull().default(20),
    /** Готов ли контент модуля (10 блоков) — иначе UI показывает кнопку генерации. */
    contentReady: boolean('content_ready').notNull().default(false),
    /** Координаты React Flow. Пересчитываются авто-раскладкой, правятся пользователем. */
    posX: doublePrecision('pos_x').notNull().default(0),
    posY: doublePrecision('pos_y').notNull().default(0),
    metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('knowledge_nodes_path_slug_uq').on(t.pathId, t.slug),
    index('knowledge_nodes_path_parent_idx').on(t.pathId, t.parentId),
    index('knowledge_nodes_status_idx').on(t.pathId, t.status),
    check('knowledge_nodes_weight_range', sql`${t.weight} >= 0 AND ${t.weight} <= 1`),
    check(
      'knowledge_nodes_difficulty_range',
      sql`${t.difficulty} >= 0 AND ${t.difficulty} <= 1`,
    ),
    check('knowledge_nodes_no_self_parent', sql`${t.parentId} IS DISTINCT FROM ${t.id}`),
  ],
);

/**
 * Рёбра графа знаний.
 * `prerequisite` блокирует доступ к узлу; `related`/`contrast`/`analogous`
 * задают пул для интерливинга (Rohrer, 2012 — смежные, но различимые темы).
 */
export const nodeEdges = pgTable(
  'node_edges',
  {
    sourceId: uuid('source_id')
      .notNull()
      .references(() => knowledgeNodes.id, { onDelete: 'cascade' }),
    targetId: uuid('target_id')
      .notNull()
      .references(() => knowledgeNodes.id, { onDelete: 'cascade' }),
    relation: nodeRelationEnum('relation').notNull(),
    /** Сила связи, 0..1. Для интерливинга — вероятность попасть в микс. */
    strength: real('strength').notNull().default(0.5),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.sourceId, t.targetId, t.relation] }),
    index('node_edges_target_idx').on(t.targetId, t.relation),
    check('node_edges_no_self_loop', sql`${t.sourceId} <> ${t.targetId}`),
    check('node_edges_strength_range', sql`${t.strength} >= 0 AND ${t.strength} <= 1`),
  ],
);

/**
 * Телеметрия мастерства по узлу (1:1 с узлом).
 * Вместо очков считаем `knowledgeStrength` (0–100) и `timeToMasterySeconds`.
 */
export const nodeProgress = pgTable(
  'node_progress',
  {
    nodeId: uuid('node_id')
      .primaryKey()
      .references(() => knowledgeNodes.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** 0–100. Композит: FSRS retrievability × точность × скорость × охват уровней Блума. */
    knowledgeStrength: integer('knowledge_strength').notNull().default(0),
    /** 0..1. Доля быстрых верных ответов (< personalThresholdMs). Порог автоматизма. */
    automaticityIndex: real('automaticity_index').notNull().default(0),
    accuracyRate: real('accuracy_rate').notNull().default(0),
    medianResponseTimeMs: integer('median_response_time_ms'),
    totalReps: integer('total_reps').notNull().default(0),
    totalPracticeMs: integer('total_practice_ms').notNull().default(0),
    /** Разрыв «уверенность − точность» по узлу. Триггер для MetacognitiveCoach. */
    calibrationGap: real('calibration_gap'),
    firstStudiedAt: timestamp('first_studied_at', { withTimezone: true }),
    masteredAt: timestamp('mastered_at', { withTimezone: true }),
    automatedAt: timestamp('automated_at', { withTimezone: true }),
    /** Ключевая метрика геймификации: секунды от первого касания до `automated`. */
    timeToMasterySeconds: integer('time_to_mastery_seconds'),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('node_progress_user_idx').on(t.userId),
    index('node_progress_strength_idx').on(t.userId, t.knowledgeStrength),
    check(
      'node_progress_strength_range',
      sql`${t.knowledgeStrength} >= 0 AND ${t.knowledgeStrength} <= 100`,
    ),
  ],
);

export type LearningPath = typeof learningPaths.$inferSelect;
export type NewLearningPath = typeof learningPaths.$inferInsert;
export type KnowledgeNode = typeof knowledgeNodes.$inferSelect;
export type NewKnowledgeNode = typeof knowledgeNodes.$inferInsert;
export type NodeEdge = typeof nodeEdges.$inferSelect;
export type NodeProgress = typeof nodeProgress.$inferSelect;
