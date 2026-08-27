-- Откат 0009_push_log. Журнал уведомлений теряется, и вместе с ним бюджет
-- тишины на текущую неделю: сразу после отката рассылка снова считает, что
-- ничего не отправляла. Учебные данные не затрагиваются.
DROP TABLE IF EXISTS "push_log";--> statement-breakpoint
DROP TYPE IF EXISTS "public"."push_category";
