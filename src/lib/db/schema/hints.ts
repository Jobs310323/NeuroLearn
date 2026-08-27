import { index, integer, jsonb, pgEnum, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { knowledgeNodes } from './learning';
import { practiceSessions } from './practice';
import { users } from './users';

/**
 * Журнал срабатываний подсказок.
 *
 * Существует ради одного: чтобы через месяц пороги правил можно было
 * пересмотреть по данным, а не по ощущению. Сколько подсказок каждого типа
 * показано, сколько закрыто не глядя, сколько привело к действию, сколько
 * раз человек нажал «больше не показывать» — без этих чисел любая правка
 * порога будет такой же догадкой, как исходное значение.
 *
 * Это и есть исполнение дисциплины сигналов, а не её обход: подсказки
 * работают на внутрисессионных метриках уже сейчас, а накопленный журнал
 * даёт основание для следующего шага.
 *
 * Тексты ответов сюда не пишутся — только идентификаторы и числа, по которым
 * правило сработало.
 */
export const hintOutcomeEnum = pgEnum('hint_outcome', [
  /** Карточка показана. */
  'shown',
  /** Человек закрыл её, не воспользовавшись. */
  'dismissed',
  /** Человек нажал действие подсказки. */
  'acted',
  /** Человек отключил этот тип подсказок. */
  'muted',
]);

export const hintEvents = pgTable(
  'hint_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    sessionId: uuid('session_id').references(() => practiceSessions.id, {
      onDelete: 'cascade',
    }),
    nodeId: uuid('node_id').references(() => knowledgeNodes.id, { onDelete: 'set null' }),
    /** Идентификатор правила (`rest_suggestion`, …). Текст, а не enum: набор правил меняется чаще схемы. */
    ruleId: text('rule_id').notNull(),
    outcome: hintOutcomeEnum('outcome').notNull(),
    /** Порядковый номер задания в сессии, после которого сработало правило. */
    itemIndex: integer('item_index').notNull().default(0),
    /**
     * Значения, при которых правило сработало (рост медианы, число ошибок).
     * Нужны, чтобы порог можно было пересчитать задним числом по уже
     * собранным событиям, а не ждать нового месяца наблюдений после каждой
     * правки.
     */
    trigger: jsonb('trigger').$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('hint_events_user_rule_idx').on(t.userId, t.ruleId, t.createdAt),
    index('hint_events_session_idx').on(t.sessionId),
  ],
);

export type HintEvent = typeof hintEvents.$inferSelect;
export type NewHintEvent = typeof hintEvents.$inferInsert;
