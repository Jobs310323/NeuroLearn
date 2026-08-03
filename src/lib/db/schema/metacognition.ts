import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  jsonb,
  pgTable,
  real,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';

import { reflectionTypeEnum } from './enums';
import { knowledgeNodes, learningPaths } from './learning';
import { practiceSessions } from './practice';
import { users } from './users';
import type { SelfAssessment } from './types';

/**
 * Дневник обучения (Flavell, 1979 — метакогниция).
 * UI требует заполнения после каждого модуля; узел не переходит в `mastered`,
 * пока нет рефлексии типа `post_module`.
 */
export const reflections = pgTable(
  'reflections',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    pathId: uuid('path_id').references(() => learningPaths.id, { onDelete: 'cascade' }),
    nodeId: uuid('node_id').references(() => knowledgeNodes.id, { onDelete: 'cascade' }),
    sessionId: uuid('session_id').references(() => practiceSessions.id, {
      onDelete: 'set null',
    }),
    type: reflectionTypeEnum('type').notNull(),
    /** Вопросы, которые задал MetacognitiveCoach (фиксируются для аудита). */
    prompts: jsonb('prompts').$type<string[]>().notNull().default([]),
    body: text('body').notNull(),
    selfAssessment: jsonb('self_assessment').$type<SelfAssessment | null>(),
    /**
     * Разрыв калибровки: `perceivedMastery` (шкала 1–5, нормализованная в 0..1)
     * минус фактическая точность по узлу. >0 — переоценка себя.
     */
    calibrationDelta: real('calibration_delta'),
    /** Оценка глубины рефлексии от коуча, 0..1 (не показывается как «оценка»). */
    depthScore: real('depth_score'),
    coachFeedback: text('coach_feedback'),
    wordCount: integer('word_count').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('reflections_user_created_idx').on(t.userId, t.createdAt),
    index('reflections_node_type_idx').on(t.nodeId, t.type),
    check('reflections_body_not_empty', sql`length(btrim(${t.body})) > 0`),
  ],
);

export type Reflection = typeof reflections.$inferSelect;
export type NewReflection = typeof reflections.$inferInsert;
