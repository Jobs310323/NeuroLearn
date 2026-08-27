import { sql } from 'drizzle-orm';
import { check, index, integer, jsonb, pgEnum, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

import { knowledgeNodes } from './learning';
import { users } from './users';

/**
 * N-of-1 эксперимент над собственной практикой (PRD: не угадывать, что
 * работает для этого человека, а проверять).
 *
 * Единица рандомизации — узел, а не сессия: если менять переменную от сессии
 * к сессии, ветки перемешиваются внутри одного дня и эффект нельзя приписать
 * ветке. Узел один раз попадает в ветку A или B и остаётся в ней на весь
 * эксперимент — вся телеметрия по нему принадлежит одной ветке.
 */
export const experimentStatusEnum = pgEnum('experiment_status', [
  'draft',
  'running',
  'completed',
  'aborted',
]);

export const experimentArmEnum = pgEnum('experiment_arm', ['a', 'b']);

export const learningExperiments = pgTable(
  'learning_experiments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** Формулировка проверяемого утверждения, своими словами. */
    hypothesis: text('hypothesis').notNull(),
    /** Независимая переменная, которую меняет эксперимент (например, `interleaveRatio`). */
    variable: text('variable').notNull(),
    /** Параметры ветки A, накладываются поверх обычной политики подбора. */
    armA: jsonb('arm_a').$type<Record<string, unknown>>().notNull(),
    /** Параметры ветки B. */
    armB: jsonb('arm_b').$type<Record<string, unknown>>().notNull(),
    /** Метрика сравнения — например, `delayed_accuracy` (точность на проверках через >= windowDays). */
    metric: text('metric').notNull(),
    /** Отложенная проверка учитывается не раньше этого числа дней после практики. */
    windowDays: integer('window_days').notNull().default(7),
    status: experimentStatusEnum('status').notNull().default('draft'),
    startedAt: timestamp('started_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('learning_experiments_user_status_idx').on(t.userId, t.status),
    check('learning_experiments_window_positive', sql`${t.windowDays} >= 1`),
  ],
);

/**
 * Распределение узла по ветке. Отдельная таблица, а не колонка на узле:
 * узел участвует не более чем в одном эксперименте одновременно (уникальный
 * индекс), но со временем — в разных, и история распределений должна остаться
 * читаемой после завершения эксперимента.
 */
export const experimentAssignments = pgTable(
  'learning_experiment_assignments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    experimentId: uuid('experiment_id')
      .notNull()
      .references(() => learningExperiments.id, { onDelete: 'cascade' }),
    nodeId: uuid('node_id')
      .notNull()
      .references(() => knowledgeNodes.id, { onDelete: 'cascade' }),
    arm: experimentArmEnum('arm').notNull(),
    assignedAt: timestamp('assigned_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // Узел закреплён за одной веткой одного эксперимента — иначе телеметрия
    // по нему нельзя однозначно приписать A или B.
    uniqueIndex('experiment_assignments_experiment_node_uq').on(t.experimentId, t.nodeId),
    index('experiment_assignments_node_idx').on(t.nodeId),
  ],
);

export type LearningExperiment = typeof learningExperiments.$inferSelect;
export type NewLearningExperiment = typeof learningExperiments.$inferInsert;
export type ExperimentAssignment = typeof experimentAssignments.$inferSelect;
export type NewExperimentAssignment = typeof experimentAssignments.$inferInsert;
