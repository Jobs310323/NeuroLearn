import { pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

import { users } from './users';

/**
 * Подписка Web Push (`PushSubscription` из браузерного API).
 *
 * Одно устройство — одна строка: `endpoint` уникален для браузера/устройства,
 * и повторная подписка с того же устройства обновляет ключи, а не копит дубли.
 * Ключи (`p256dh`, `auth`) нужны `web-push` для шифрования payload — без них
 * доставка невозможна, это не техническая деталь, а часть протокола Push API.
 */
export const pushSubscriptions = pgTable(
  'push_subscriptions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    endpoint: text('endpoint').notNull(),
    p256dh: text('p256dh').notNull(),
    auth: text('auth').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('push_subscriptions_endpoint_uq').on(t.endpoint)],
);

export type PushSubscriptionRow = typeof pushSubscriptions.$inferSelect;
export type NewPushSubscriptionRow = typeof pushSubscriptions.$inferInsert;
