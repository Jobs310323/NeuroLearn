import {
  boolean,
  index,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

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
    /**
     * Имя устройства для списка в настройках. Пустое — покажем разбор
     * `userAgent`; человек может переименовать («рабочий ноутбук»).
     * Без имени список подписок нечитаем: три строки с одинаковым
     * `endpoint`-хвостом невозможно отличить, а отзывать надо конкретную.
     */
    label: text('label'),
    /** Сырой User-Agent на момент подписки — источник для авто-имени. */
    userAgent: text('user_agent'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('push_subscriptions_endpoint_uq').on(t.endpoint),
    index('push_subscriptions_user_idx').on(t.userId, t.createdAt),
  ],
);

export type PushSubscriptionRow = typeof pushSubscriptions.$inferSelect;
export type NewPushSubscriptionRow = typeof pushSubscriptions.$inferInsert;

/**
 * Журнал отправленных уведомлений.
 *
 * Существует ради бюджета тишины: без записи о том, что уже уходило, лимит
 * «не больше двух в неделю» не с чем сравнивать. Хранится только категория и
 * время — тексты уведомлений выводятся из данных и заново, а копить их значит
 * дублировать учебные данные в третьем месте.
 *
 * Он же питает счётчик в настройках: человек должен видеть, сколько
 * уведомлений приложение себе позволило, а не узнавать это по факту.
 */
export const pushCategoryEnum = pgEnum('push_category', [
  'review_due',
  'node_weak',
  'experiment_ready',
  'note_capsule',
]);

export const pushLog = pgTable(
  'push_log',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    category: pushCategoryEnum('category').notNull(),
    /** Доставлено ли: неудачная отправка бюджет не тратит. */
    delivered: boolean('delivered').notNull().default(true),
    sentAt: timestamp('sent_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('push_log_user_sent_idx').on(t.userId, t.category, t.sentAt)],
);

export type PushLogRow = typeof pushLog.$inferSelect;
