import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  real,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';

import { assessments } from './content';
import { practiceModeEnum } from './enums';
import { knowledgeNodes, learningPaths } from './learning';
import { users } from './users';
import type { SessionConfig, UserResponsePayload } from './types';

/**
 * Сессия практики. Конфигурация фиксируется на старте, чтобы результат
 * можно было воспроизвести и проанализировать (в т.ч. эффект интерливинга).
 */
export const practiceSessions = pgTable(
  'practice_sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    pathId: uuid('path_id').references(() => learningPaths.id, { onDelete: 'cascade' }),
    /** Основной узел сессии; при `interleaved` — узел-якорь. */
    primaryNodeId: uuid('primary_node_id').references(() => knowledgeNodes.id, {
      onDelete: 'set null',
    }),
    mode: practiceModeEnum('mode').notNull(),
    /** Параметр `mix=true` из контракта практики. */
    interleaved: boolean('interleaved').notNull().default(false),
    config: jsonb('config').$type<SessionConfig>().notNull(),
    /** Порядок вопросов, зафиксированный на старте (для delayed feedback и аудита). */
    itemOrder: jsonb('item_order').$type<string[]>().notNull().default([]),
    itemCount: integer('item_count').notNull().default(0),
    correctCount: integer('correct_count').notNull().default(0),
    /** 0..1. Заполняется при завершении. */
    score: real('score'),
    durationMs: integer('duration_ms'),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
  },
  (t) => [
    index('practice_sessions_user_started_idx').on(t.userId, t.startedAt),
    index('practice_sessions_open_idx')
      .on(t.userId, t.completedAt)
      .where(sql`${t.completedAt} IS NULL`),
  ],
);

/**
 * Ответ пользователя — атомарная единица телеметрии обучения.
 * `confidenceLevel` собирается ДО показа результата: пара
 * (уверенность, правильность) даёт калибровку метакогниции.
 */
export const userResponses = pgTable(
  'user_responses',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    sessionId: uuid('session_id').references(() => practiceSessions.id, {
      onDelete: 'cascade',
    }),
    assessmentId: uuid('assessment_id')
      .notNull()
      .references(() => assessments.id, { onDelete: 'cascade' }),
    /** Денормализовано для быстрых агрегатов по узлу. */
    nodeId: uuid('node_id')
      .notNull()
      .references(() => knowledgeNodes.id, { onDelete: 'cascade' }),
    response: jsonb('response').$type<UserResponsePayload>().notNull(),
    isCorrect: boolean('is_correct').notNull(),
    /** 0..1 для частично верных ответов (multi_select, ordering, rubric). */
    partialScore: real('partial_score').notNull().default(0),
    responseTimeMs: integer('response_time_ms').notNull(),
    /** 1..5, собирается до раскрытия ответа. */
    confidenceLevel: integer('confidence_level'),
    /** Была ли предпринята попытка вспомнить до подсказки (эффект генерации). */
    retrievalAttempted: boolean('retrieval_attempted').notNull().default(true),
    hintsUsed: integer('hints_used').notNull().default(0),
    /** Когда пользователю показали результат. NULL до раскрытия при delayed feedback. */
    feedbackShownAt: timestamp('feedback_shown_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('user_responses_user_node_idx').on(t.userId, t.nodeId, t.createdAt),
    index('user_responses_assessment_idx').on(t.assessmentId),
    index('user_responses_session_idx').on(t.sessionId),
    check(
      'user_responses_confidence_range',
      sql`${t.confidenceLevel} IS NULL OR (${t.confidenceLevel} >= 1 AND ${t.confidenceLevel} <= 5)`,
    ),
    check(
      'user_responses_partial_range',
      sql`${t.partialScore} >= 0 AND ${t.partialScore} <= 1`,
    ),
    check('user_responses_time_positive', sql`${t.responseTimeMs} >= 0`),
  ],
);

export type PracticeSession = typeof practiceSessions.$inferSelect;
export type NewPracticeSession = typeof practiceSessions.$inferInsert;
export type UserResponse = typeof userResponses.$inferSelect;
export type NewUserResponse = typeof userResponses.$inferInsert;
