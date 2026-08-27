-- Откат 0007_practice_hints. Журнал срабатываний подсказок теряется целиком:
-- это данные для будущей настройки порогов, восстановить их можно только
-- накопив заново. Настройки подсказок в users.preferences не трогаются —
-- они пришли миграцией 0005 и живут своей жизнью.
DROP TABLE IF EXISTS "hint_events";--> statement-breakpoint
DROP TYPE IF EXISTS "public"."hint_outcome";
