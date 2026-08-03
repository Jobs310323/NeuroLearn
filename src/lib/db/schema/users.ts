import { integer, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import {
  DEFAULT_COGNITIVE_PROFILE,
  DEFAULT_USER_PREFERENCES,
  type CognitiveProfile,
  type UserPreferences,
} from './types';

/**
 * Профиль поверх `auth.users` из Supabase.
 * `id` совпадает с `auth.users.id` (FK ставится SQL-миграцией, т.к. схема `auth`
 * не описывается Drizzle). RLS: `auth.uid() = id`.
 */
export const users = pgTable('users', {
  id: uuid('id').primaryKey(),
  email: text('email').notNull(),
  displayName: text('display_name'),
  avatarUrl: text('avatar_url'),
  timezone: text('timezone').notNull().default('UTC'),
  dailyGoalMinutes: integer('daily_goal_minutes').notNull().default(20),
  cognitiveProfile: jsonb('cognitive_profile')
    .$type<CognitiveProfile>()
    .notNull()
    .default(DEFAULT_COGNITIVE_PROFILE),
  preferences: jsonb('preferences')
    .$type<UserPreferences>()
    .notNull()
    .default(DEFAULT_USER_PREFERENCES),
  onboardedAt: timestamp('onboarded_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;

// Связи объявлены в `relations.ts` — единым файлом, чтобы избежать циклов импорта.
