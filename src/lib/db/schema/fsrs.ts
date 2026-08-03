import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  pgTable,
  real,
  smallint,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { fsrsRatingEnum, fsrsStateEnum } from './enums';
import { knowledgeNodes } from './learning';
import { practiceSessions } from './practice';
import { users } from './users';

/**
 * Карточка интервального повторения. Единица планирования — узел знаний
 * (повторение узла = короткий смешанный набор его заданий).
 *
 * Поля 1:1 соответствуют типу `Card` из `ts-fsrs`. Алгоритм SM-2 не пишем —
 * планирование делает ts-fsrs (FSRS-5), здесь только персистентное состояние.
 * Маппинг enum <-> числовые `State`/`Rating` живёт в `lib/services/fsrs/mapping.ts`
 * и покрыт unit-тестами.
 */
export const fsrsCards = pgTable(
  'fsrs_cards',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    nodeId: uuid('node_id')
      .notNull()
      .references(() => knowledgeNodes.id, { onDelete: 'cascade' }),
    due: timestamp('due', { withTimezone: true }).notNull().defaultNow(),
    stability: real('stability').notNull().default(0),
    difficulty: real('difficulty').notNull().default(0),
    elapsedDays: integer('elapsed_days').notNull().default(0),
    scheduledDays: integer('scheduled_days').notNull().default(0),
    learningSteps: smallint('learning_steps').notNull().default(0),
    reps: integer('reps').notNull().default(0),
    lapses: integer('lapses').notNull().default(0),
    state: fsrsStateEnum('state').notNull().default('new'),
    lastReview: timestamp('last_review', { withTimezone: true }),
    /** Приостановка карточки без потери истории. */
    suspendedUntil: timestamp('suspended_until', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('fsrs_cards_user_node_uq').on(t.userId, t.nodeId),
    /** Основной индекс очереди повторений. */
    index('fsrs_cards_due_idx').on(t.userId, t.due),
    check('fsrs_cards_stability_positive', sql`${t.stability} >= 0`),
    check(
      'fsrs_cards_difficulty_range',
      sql`${t.difficulty} >= 0 AND ${t.difficulty} <= 10`,
    ),
  ],
);

/**
 * Журнал повторений — соответствует `ReviewLog` из ts-fsrs.
 * Нужен для отката (`rollback`), пересчёта расписания при смене параметров
 * и последующей оптимизации весов FSRS на личных данных.
 */
export const reviewLogs = pgTable(
  'review_logs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    cardId: uuid('card_id')
      .notNull()
      .references(() => fsrsCards.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    sessionId: uuid('session_id').references(() => practiceSessions.id, {
      onDelete: 'set null',
    }),
    rating: fsrsRatingEnum('rating').notNull(),
    /** Состояние карточки ДО применения оценки. */
    state: fsrsStateEnum('state').notNull(),
    due: timestamp('due', { withTimezone: true }).notNull(),
    stability: real('stability').notNull(),
    difficulty: real('difficulty').notNull(),
    elapsedDays: integer('elapsed_days').notNull(),
    lastElapsedDays: integer('last_elapsed_days').notNull(),
    scheduledDays: integer('scheduled_days').notNull(),
    learningSteps: smallint('learning_steps').notNull().default(0),
    /** Момент повторения (`review` в ts-fsrs). */
    reviewedAt: timestamp('reviewed_at', { withTimezone: true }).notNull(),
    /** Как оценка была получена: из точности сессии или выставлена вручную. */
    derivedFrom: smallint('derived_from').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('review_logs_card_idx').on(t.cardId, t.reviewedAt),
    index('review_logs_user_idx').on(t.userId, t.reviewedAt),
  ],
);

export type FsrsCard = typeof fsrsCards.$inferSelect;
export type NewFsrsCard = typeof fsrsCards.$inferInsert;
export type ReviewLog = typeof reviewLogs.$inferSelect;
export type NewReviewLog = typeof reviewLogs.$inferInsert;
