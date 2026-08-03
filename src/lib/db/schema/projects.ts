import {
  index,
  integer,
  jsonb,
  pgTable,
  real,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';

import { submissionStatusEnum } from './enums';
import { knowledgeNodes, learningPaths } from './learning';
import { users } from './users';
import type { ProjectRubric } from './types';

/**
 * Проект — перенос навыка в реальный контекст (transfer).
 * Привязывается к пути или к конкретному узлу-вершине.
 */
export const projects = pgTable(
  'projects',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    pathId: uuid('path_id')
      .notNull()
      .references(() => learningPaths.id, { onDelete: 'cascade' }),
    nodeId: uuid('node_id').references(() => knowledgeNodes.id, { onDelete: 'set null' }),
    title: text('title').notNull(),
    brief: text('brief').notNull(),
    /** Узлы, которые проект должен задействовать (проверка охвата). */
    coveredNodeIds: jsonb('covered_node_ids').$type<string[]>().notNull().default([]),
    rubric: jsonb('rubric').$type<ProjectRubric>().notNull(),
    estimatedHours: integer('estimated_hours'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('projects_path_idx').on(t.pathId)],
);

/**
 * Сдача проекта. ИИ не пишет решение — он проводит защиту:
 * задаёт вопросы по коду/кейсу и фиксирует пробелы в `user_context`.
 */
export const projectSubmissions = pgTable(
  'project_submissions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    status: submissionStatusEnum('status').notNull().default('draft'),
    artifactUrl: text('artifact_url'),
    content: text('content'),
    /** Вопросы защиты, сгенерированные по фактическому артефакту. */
    defenseQuestions: jsonb('defense_questions').$type<string[]>().notNull().default([]),
    /** Ссылка на диалог защиты в `tutor_conversations`. */
    defenseConversationId: uuid('defense_conversation_id'),
    rubricScores: jsonb('rubric_scores')
      .$type<Record<string, number>>()
      .notNull()
      .default({}),
    /** Итоговая оценка защиты, 0..1. */
    defenseScore: real('defense_score'),
    /** Узлы, где защита вскрыла пробелы -> статус `has_gaps` + внеочередное повторение. */
    revealedGapNodeIds: jsonb('revealed_gap_node_ids').$type<string[]>().notNull().default([]),
    submittedAt: timestamp('submitted_at', { withTimezone: true }),
    reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('project_submissions_user_idx').on(t.userId, t.status),
    index('project_submissions_project_idx').on(t.projectId),
  ],
);

export type Project = typeof projects.$inferSelect;
export type NewProject = typeof projects.$inferInsert;
export type ProjectSubmission = typeof projectSubmissions.$inferSelect;
export type NewProjectSubmission = typeof projectSubmissions.$inferInsert;
