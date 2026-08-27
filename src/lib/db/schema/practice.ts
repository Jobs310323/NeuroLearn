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

import { assessments } from './content';
import { errorKindEnum, practiceModeEnum } from './enums';
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
    /**
     * Время от показа задания до фиксации ответа. Выбор уверенности сюда
     * НЕ входит — он идёт отдельным шагом уже после остановки таймера.
     *
     * Это условие измеримости автоматизма (PRD §5): порог там порядка
     * секунд, а клик по шкале 1–5 стоит примерно столько же. Пока оба
     * интервала складывались в одно число, `automaticity_index` и медиана
     * времени по узлу измеряли скорость работы с интерфейсом наравне со
     * скоростью извлечения из памяти.
     */
    responseTimeMs: integer('response_time_ms').notNull(),
    /** 1..5, собирается до раскрытия ответа (постдиктивная уверенность). */
    confidenceLevel: integer('confidence_level'),
    /**
     * 1..5, Judgment of Knowing — проспективная оценка, собирается ДО попытки
     * ответить (в момент показа задания, до ввода). В отличие от
     * `confidenceLevel` (постдиктивная: «насколько уверен в уже данном
     * ответе»), JOK — продиктивная: «насколько, по ощущению, я знаю это,
     * ещё не начав решать» (Koriat, feeling-of-knowing). Два разных вопроса
     * метакогниции: JOK предсказывает, confidenceLevel оценивает задним числом.
     */
    jokLevel: integer('jok_level'),
    /**
     * Сколько заняла сама оценка уверенности. Хранится отдельно, а не
     * выбрасывается: долгое раздумье над шкалой — признак низкой
     * метакогнитивной уверенности (Koriat, cue-utilization framework),
     * и это самостоятельный сигнал, а не шум.
     */
    confidenceLatencyMs: integer('confidence_latency_ms'),
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
      'user_responses_jok_range',
      sql`${t.jokLevel} IS NULL OR (${t.jokLevel} >= 1 AND ${t.jokLevel} <= 5)`,
    ),
    check(
      'user_responses_partial_range',
      sql`${t.partialScore} >= 0 AND ${t.partialScore} <= 1`,
    ),
    check('user_responses_time_positive', sql`${t.responseTimeMs} >= 0`),
    check(
      'user_responses_confidence_latency_positive',
      sql`${t.confidenceLatencyMs} IS NULL OR ${t.confidenceLatencyMs} >= 0`,
    ),
  ],
);

/**
 * Разбор неверного ответа: какого рода ошибка и на чём это видно.
 *
 * Отдельная таблица, а не колонка в `user_responses`, по двум причинам.
 * Разбор появляется позже самого ответа (пакетом после сессии) и может
 * не появиться вовсе — если модель недоступна, ответ всё равно должен
 * сохраниться. И разбор переделывается при смене промпта или классификатора,
 * а сам ответ — исходные данные, их переписывать нельзя.
 *
 * Зачем различать ошибки. Тип ошибки решает, что показывать дальше:
 * `conceptual` (устойчивое заблуждение) лечится контрастными случаями —
 * двумя близкими примерами с выделенным критическим различием (PRD §3 п.7,
 * вариативность практики); `transfer_failure` — разобранным примером в новом
 * контексте (п.9, worked examples, Sweller & Cooper, 1985); `careless` не
 * лечится материалом вообще и требует другого темпа, а не новой теории.
 */
export const responseDiagnoses = pgTable(
  'response_diagnoses',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    responseId: uuid('response_id')
      .notNull()
      .references(() => userResponses.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** Денормализовано — разбор почти всегда читается срезом по узлу. */
    nodeId: uuid('node_id')
      .notNull()
      .references(() => knowledgeNodes.id, { onDelete: 'cascade' }),
    kind: errorKindEnum('kind').notNull(),
    /** Формулировка заблуждения своими словами — она же идёт в `AgentFacts.misconceptions`. */
    misconception: text('misconception'),
    /** На чём основан вывод: цитата из ответа или замеченное расхождение. */
    evidence: text('evidence').notNull(),
    /** Уверенность классификатора 0..1. Ниже порога разбор не влияет на подбор материала. */
    confidence: real('confidence').notNull().default(0.5),
    /** Модель и версия промпта — чтобы отличить старые разборы от новых. */
    generatedBy: text('generated_by'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // Один разбор на ответ: повторная классификация заменяет прежний,
    // а не копит историю мнений об одном и том же.
    uniqueIndex('response_diagnoses_response_uq').on(t.responseId),
    index('response_diagnoses_user_node_idx').on(t.userId, t.nodeId, t.createdAt),
    index('response_diagnoses_kind_idx').on(t.userId, t.kind),
    check(
      'response_diagnoses_confidence_range',
      sql`${t.confidence} >= 0 AND ${t.confidence} <= 1`,
    ),
  ],
);

export type ResponseDiagnosis = typeof responseDiagnoses.$inferSelect;
export type NewResponseDiagnosis = typeof responseDiagnoses.$inferInsert;

export type PracticeSession = typeof practiceSessions.$inferSelect;
export type NewPracticeSession = typeof practiceSessions.$inferInsert;
export type UserResponse = typeof userResponses.$inferSelect;
export type NewUserResponse = typeof userResponses.$inferInsert;
