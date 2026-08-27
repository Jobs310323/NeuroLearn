-- Откат 0004_push_devices.
-- Данные колонок теряются безвозвратно: `label` — введённое человеком имя
-- устройства, `user_agent` — снимок на момент подписки. Сами подписки живы.
DROP INDEX IF EXISTS "push_subscriptions_user_idx";--> statement-breakpoint
ALTER TABLE "push_subscriptions" DROP COLUMN IF EXISTS "user_agent";--> statement-breakpoint
ALTER TABLE "push_subscriptions" DROP COLUMN IF EXISTS "label";
