CREATE TYPE "public"."note_color" AS ENUM('neutral', 'insight', 'question', 'gap', 'source', 'contradiction');--> statement-breakpoint
CREATE TYPE "public"."note_relation" AS ENUM('supports', 'contradicts', 'extends', 'question_of', 'example_of');--> statement-breakpoint
CREATE TYPE "public"."note_type" AS ENUM('capture', 'summary', 'idea', 'reflection', 'question', 'quote', 'link_note');--> statement-breakpoint
CREATE TABLE "note_links" (
	"from_note_id" uuid NOT NULL,
	"to_note_id" uuid NOT NULL,
	"relation" "note_relation" NOT NULL,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "note_links_from_note_id_to_note_id_relation_pk" PRIMARY KEY("from_note_id","to_note_id","relation"),
	CONSTRAINT "note_links_no_self_loop" CHECK ("note_links"."from_note_id" <> "note_links"."to_note_id")
);
--> statement-breakpoint
CREATE TABLE "notes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"type" "note_type" DEFAULT 'capture' NOT NULL,
	"title" text,
	"content_md" text DEFAULT '' NOT NULL,
	"color_label" "note_color" DEFAULT 'neutral' NOT NULL,
	"tags" text[] DEFAULT '{}'::text[] NOT NULL,
	"node_id" uuid,
	"session_id" uuid,
	"assessment_id" uuid,
	"experiment_id" uuid,
	"source_id" uuid,
	"source_anchor" jsonb,
	"parent_note_id" uuid,
	"resurface_at" timestamp with time zone,
	"resurface_reason" text,
	"capsule" jsonb,
	"confusion_flag" boolean DEFAULT false NOT NULL,
	"tutor_conversation_id" uuid,
	"pinned" boolean DEFAULT false NOT NULL,
	"is_archived" boolean DEFAULT false NOT NULL,
	"ai_processed_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"conflict_of_note_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notes_version_positive" CHECK ("notes"."version" >= 1),
	CONSTRAINT "notes_no_self_parent" CHECK ("notes"."parent_note_id" IS DISTINCT FROM "notes"."id"),
	CONSTRAINT "notes_no_self_conflict" CHECK ("notes"."conflict_of_note_id" IS DISTINCT FROM "notes"."id")
);
--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "preferences" SET DEFAULT '{"locale":"ru","theme":"system","showScienceHints":true,"reduceMotion":false,"reviewRemindersEnabled":true,"requestRetention":0.9,"fsrsWeights":null,"fsrsWeightsUpdatedAt":null,"fsrsOptimizationReady":false,"hints":{"enabled":true,"disabledRules":[]},"aiOnNotes":false,"onboarding":{"completed":false,"skipped":false,"lastStep":0}}'::jsonb;--> statement-breakpoint
ALTER TABLE "note_links" ADD CONSTRAINT "note_links_from_note_id_notes_id_fk" FOREIGN KEY ("from_note_id") REFERENCES "public"."notes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "note_links" ADD CONSTRAINT "note_links_to_note_id_notes_id_fk" FOREIGN KEY ("to_note_id") REFERENCES "public"."notes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "note_links" ADD CONSTRAINT "note_links_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notes" ADD CONSTRAINT "notes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notes" ADD CONSTRAINT "notes_node_id_knowledge_nodes_id_fk" FOREIGN KEY ("node_id") REFERENCES "public"."knowledge_nodes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notes" ADD CONSTRAINT "notes_session_id_practice_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."practice_sessions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notes" ADD CONSTRAINT "notes_assessment_id_assessments_id_fk" FOREIGN KEY ("assessment_id") REFERENCES "public"."assessments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notes" ADD CONSTRAINT "notes_experiment_id_learning_experiments_id_fk" FOREIGN KEY ("experiment_id") REFERENCES "public"."learning_experiments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notes" ADD CONSTRAINT "notes_source_id_source_documents_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."source_documents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notes" ADD CONSTRAINT "notes_parent_note_id_notes_id_fk" FOREIGN KEY ("parent_note_id") REFERENCES "public"."notes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notes" ADD CONSTRAINT "notes_tutor_conversation_id_tutor_conversations_id_fk" FOREIGN KEY ("tutor_conversation_id") REFERENCES "public"."tutor_conversations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notes" ADD CONSTRAINT "notes_conflict_of_note_id_notes_id_fk" FOREIGN KEY ("conflict_of_note_id") REFERENCES "public"."notes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "note_links_to_idx" ON "note_links" USING btree ("to_note_id","relation");--> statement-breakpoint
CREATE INDEX "note_links_user_idx" ON "note_links" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "notes_user_updated_idx" ON "notes" USING btree ("user_id","updated_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "notes_user_node_idx" ON "notes" USING btree ("user_id","node_id");--> statement-breakpoint
CREATE INDEX "notes_user_type_idx" ON "notes" USING btree ("user_id","type");--> statement-breakpoint
CREATE INDEX "notes_resurface_idx" ON "notes" USING btree ("resurface_at") WHERE "notes"."resurface_at" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "notes_confusion_idx" ON "notes" USING btree ("user_id","created_at") WHERE "notes"."confusion_flag" = true;--> statement-breakpoint
CREATE INDEX "notes_fts_idx" ON "notes" USING gin (to_tsvector('simple', coalesce("title", '') || ' ' || "content_md"));--> statement-breakpoint
-- Смена DEFAULT не трогает уже существующие строки: у заведённых раньше
-- пользователей в `preferences` просто нет новых ключей. `defaults || stored`
-- добавляет недостающее, сохраняя всё, что человек уже выбрал (правый
-- операнд `||` выигрывает при совпадении ключей).
UPDATE "users"
SET "preferences" =
  '{"hints":{"enabled":true,"disabledRules":[]},"aiOnNotes":false,"onboarding":{"completed":false,"skipped":false,"lastStep":0}}'::jsonb
  || "preferences";
