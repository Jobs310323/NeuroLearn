ALTER TABLE "learning_paths" ADD COLUMN "layout_version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "learning_paths" ADD COLUMN "layout_grouping" text DEFAULT 'bloom' NOT NULL;