import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  real,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import {
  assessmentTypeEnum,
  cognitiveLevelEnum,
  contentBlockTypeEnum,
  feedbackModeEnum,
} from './enums';
import { knowledgeNodes } from './learning';
import type { AssessmentPayload, ContentPayload, CorrectAnswer } from './types';

/**
 * Блок материала внутри узла. Ровно 10 блоков на узел (см. `contentBlockTypeEnum`),
 * первый — `pre_assessment`: тема всегда начинается с теста, а не с теории.
 */
export const contentBlocks = pgTable(
  'content_blocks',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    nodeId: uuid('node_id')
      .notNull()
      .references(() => knowledgeNodes.id, { onDelete: 'cascade' }),
    type: contentBlockTypeEnum('type').notNull(),
    title: text('title').notNull(),
    orderIndex: integer('order_index').notNull(),
    payload: jsonb('payload').$type<ContentPayload>().notNull(),
    /**
     * Денормализованный флаг из ТЗ: материал помечается как предварительная проверка.
     * Всегда истинен ровно для блока типа `pre_assessment` (см. check).
     */
    preAssessment: boolean('pre_assessment').notNull().default(false),
    /** Ключ исследования из `lib/science/citations.ts` для тултипа «Почему мы так делаем?». */
    scienceCitationKey: text('science_citation_key'),
    /** Обязателен ли блок для перехода к следующему. */
    required: boolean('required').notNull().default(true),
    generatedBy: text('generated_by'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('content_blocks_node_order_uq').on(t.nodeId, t.orderIndex),
    index('content_blocks_node_type_idx').on(t.nodeId, t.type),
    check(
      'content_blocks_pre_assessment_consistency',
      sql`(${t.type} = 'pre_assessment') = ${t.preAssessment}`,
    ),
  ],
);

/**
 * Вопрос/задание. Живёт на узле; может быть привязан к конкретному блоку.
 *
 * Вариативность практики: `variantGroupId` объединяет 3–5 формулировок одного
 * навыка в разных контекстах, `contextLabel` описывает контекст. Движок практики
 * никогда не берёт два варианта одной группы в одну сессию.
 *
 * Отложенная обратная связь (Shute, 2008): для `recall`/`understand` ставим
 * `instant`, для `apply` и выше — `delayed` (результат только после сессии).
 */
export const assessments = pgTable(
  'assessments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    nodeId: uuid('node_id')
      .notNull()
      .references(() => knowledgeNodes.id, { onDelete: 'cascade' }),
    contentBlockId: uuid('content_block_id').references(() => contentBlocks.id, {
      onDelete: 'set null',
    }),
    type: assessmentTypeEnum('type').notNull(),
    cognitiveLevel: cognitiveLevelEnum('cognitive_level').notNull().default('recall'),
    prompt: text('prompt').notNull(),
    payload: jsonb('payload').$type<AssessmentPayload>().notNull(),
    correctAnswer: jsonb('correct_answer').$type<CorrectAnswer>().notNull(),
    explanation: text('explanation'),
    /** Наводящие вопросы для тьютора при ошибке. Готовый ответ не выдаётся. */
    socraticHints: jsonb('socratic_hints').$type<string[]>().notNull().default([]),
    feedbackMode: feedbackModeEnum('feedback_mode').notNull().default('instant'),
    /** Пары флагов из ТЗ; выводятся из `feedbackMode` (см. check — они всегда взаимоисключающи). */
    instantFeedback: boolean('instant_feedback').notNull().default(true),
    delayedFeedback: boolean('delayed_feedback').notNull().default(false),
    isPreAssessment: boolean('is_pre_assessment').notNull().default(false),
    /** Априорная сложность 0..1; уточняется по `user_responses` (ProgressAnalyzer). */
    difficulty: real('difficulty').notNull().default(0.5),
    /** Дискриминативность 0..1 — насколько вопрос отделяет знающих от незнающих. */
    discrimination: real('discrimination'),
    /** Целевое время ответа для оценки автоматизма, мс. */
    targetResponseMs: integer('target_response_ms'),
    variantGroupId: uuid('variant_group_id'),
    contextLabel: text('context_label'),
    tags: jsonb('tags').$type<string[]>().notNull().default([]),
    active: boolean('active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('assessments_node_active_idx').on(t.nodeId, t.active),
    index('assessments_variant_group_idx').on(t.variantGroupId),
    index('assessments_pre_idx').on(t.nodeId, t.isPreAssessment),
    check(
      'assessments_feedback_exclusive',
      sql`${t.instantFeedback} <> ${t.delayedFeedback}`,
    ),
    check(
      'assessments_feedback_mode_sync',
      sql`(${t.feedbackMode} = 'instant') = ${t.instantFeedback}`,
    ),
    check('assessments_difficulty_range', sql`${t.difficulty} >= 0 AND ${t.difficulty} <= 1`),
  ],
);

export type ContentBlock = typeof contentBlocks.$inferSelect;
export type NewContentBlock = typeof contentBlocks.$inferInsert;
export type Assessment = typeof assessments.$inferSelect;
export type NewAssessment = typeof assessments.$inferInsert;
