import {
  index,
  integer,
  jsonb,
  pgTable,
  real,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';

import { agentKindEnum, contextScopeEnum, generationStatusEnum, messageRoleEnum } from './enums';
import { knowledgeNodes, learningPaths } from './learning';
import { users } from './users';
import type { AgentFacts } from './types';

/**
 * Общая «доска» четырёх агентов (ContentGenerator, Tutor, ProgressAnalyzer,
 * MetacognitiveCoach). Каждый агент пишет свой срез; при сборке промпта
 * читаются все срезы нужного scope. Так агенты обмениваются состоянием,
 * не вызывая друг друга напрямую.
 */
export const userContext = pgTable(
  'user_context',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    agent: agentKindEnum('agent').notNull(),
    scope: contextScopeEnum('scope').notNull(),
    pathId: uuid('path_id').references(() => learningPaths.id, { onDelete: 'cascade' }),
    nodeId: uuid('node_id').references(() => knowledgeNodes.id, { onDelete: 'cascade' }),
    /** Сжатая сводка для вставки в системный промпт (бюджет ~800 токенов). */
    summary: text('summary').notNull().default(''),
    facts: jsonb('facts').$type<AgentFacts>().notNull().default({
      strengths: [],
      gaps: [],
      misconceptions: [],
      recommendedFocusNodeIds: [],
      notes: '',
    }),
    /** Оптимистическая блокировка при параллельной записи агентами. */
    version: integer('version').notNull().default(1),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // NULLS NOT DISTINCT: у scope='global' поля path_id/node_id пустые,
    // без этого Postgres считал бы такие строки различными и слот дублировался.
    unique('user_context_slot_uq')
      .on(t.userId, t.agent, t.scope, t.pathId, t.nodeId)
      .nullsNotDistinct(),
    index('user_context_user_agent_idx').on(t.userId, t.agent),
  ],
);

/** Диалог с тьютором. Всегда сократический: готовые ответы не выдаются. */
export const tutorConversations = pgTable(
  'tutor_conversations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    nodeId: uuid('node_id').references(() => knowledgeNodes.id, { onDelete: 'set null' }),
    pathId: uuid('path_id').references(() => learningPaths.id, { onDelete: 'cascade' }),
    title: text('title').notNull().default('Диалог'),
    /** Скользящая сводка старых сообщений — память диалога без роста контекста. */
    memorySummary: text('memory_summary').notNull().default(''),
    messageCount: integer('message_count').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('tutor_conversations_user_idx').on(t.userId, t.updatedAt)],
);

export const tutorMessages = pgTable(
  'tutor_messages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    conversationId: uuid('conversation_id')
      .notNull()
      .references(() => tutorConversations.id, { onDelete: 'cascade' }),
    role: messageRoleEnum('role').notNull(),
    content: text('content').notNull(),
    /** Вызовы инструментов (`SocraticMethod`, `LookupNode`, `LogGap`). */
    toolCalls: jsonb('tool_calls').$type<unknown[]>().notNull().default([]),
    /** Глубина сократической цепочки: сколько наводящих вопросов уже задано. */
    socraticDepth: integer('socratic_depth').notNull().default(0),
    tokensIn: integer('tokens_in'),
    tokensOut: integer('tokens_out'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('tutor_messages_conversation_idx').on(t.conversationId, t.createdAt)],
);

/** Аудит вызовов LLM: стоимость, латентность, результат Zod-валидации. */
export const aiGenerations = pgTable(
  'ai_generations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
    agent: agentKindEnum('agent').notNull(),
    /** Логическая операция: `generate_tree`, `generate_module`, `analyze_progress`... */
    operation: text('operation').notNull(),
    model: text('model').notNull(),
    promptVersion: text('prompt_version').notNull(),
    status: generationStatusEnum('status').notNull().default('pending'),
    /** Текст ошибки Zod при `schema_failed` — вход для починки промпта. */
    validationError: text('validation_error'),
    retryCount: integer('retry_count').notNull().default(0),
    tokensIn: integer('tokens_in'),
    tokensOut: integer('tokens_out'),
    costUsd: real('cost_usd'),
    latencyMs: integer('latency_ms'),
    targetTable: text('target_table'),
    targetId: uuid('target_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('ai_generations_user_created_idx').on(t.userId, t.createdAt),
    index('ai_generations_status_idx').on(t.status, t.operation),
  ],
);

export type UserContext = typeof userContext.$inferSelect;
export type NewUserContext = typeof userContext.$inferInsert;
export type TutorConversation = typeof tutorConversations.$inferSelect;
export type TutorMessage = typeof tutorMessages.$inferSelect;
export type NewTutorMessage = typeof tutorMessages.$inferInsert;
export type AiGeneration = typeof aiGenerations.$inferSelect;
