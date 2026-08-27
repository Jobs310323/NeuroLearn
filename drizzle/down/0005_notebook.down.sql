-- Откат 0005_notebook. Удаляет тетрадь вместе со всем её содержимым:
-- заметки — авторский текст пользователя, восстановить их неоткуда.
-- Перед откатом имеет смысл выгрузить их: экспорт в Markdown/Obsidian
-- (`GET /api/notes/export`) не зависит от схемы и переживает откат.
DROP TABLE IF EXISTS "note_links";--> statement-breakpoint
DROP TABLE IF EXISTS "notes";--> statement-breakpoint
DROP TYPE IF EXISTS "public"."note_relation";--> statement-breakpoint
DROP TYPE IF EXISTS "public"."note_type";--> statement-breakpoint
DROP TYPE IF EXISTS "public"."note_color";--> statement-breakpoint
-- Ключи настроек тетради и подсказок снимаются, остальные предпочтения целы.
UPDATE "users" SET "preferences" = "preferences" - 'aiOnNotes' - 'hints' - 'onboarding';--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "preferences" SET DEFAULT '{"locale":"ru","theme":"system","showScienceHints":true,"reduceMotion":false,"reviewRemindersEnabled":true,"requestRetention":0.9,"fsrsWeights":null,"fsrsWeightsUpdatedAt":null,"fsrsOptimizationReady":false}'::jsonb;
