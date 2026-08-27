-- Откат 0006_map_layout. Ручные позиции узлов (`pos_x`/`pos_y`) не трогаются:
-- версия раскладки — только про обнаружение конфликтов, сами координаты
-- живут в knowledge_nodes и этой миграцией не создавались.
ALTER TABLE "learning_paths" DROP COLUMN IF EXISTS "layout_grouping";--> statement-breakpoint
ALTER TABLE "learning_paths" DROP COLUMN IF EXISTS "layout_version";
