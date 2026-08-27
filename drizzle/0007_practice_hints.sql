CREATE TYPE "public"."hint_outcome" AS ENUM('shown', 'dismissed', 'acted', 'muted');--> statement-breakpoint
CREATE TABLE "hint_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"session_id" uuid,
	"node_id" uuid,
	"rule_id" text NOT NULL,
	"outcome" "hint_outcome" NOT NULL,
	"item_index" integer DEFAULT 0 NOT NULL,
	"trigger" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "hint_events" ADD CONSTRAINT "hint_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hint_events" ADD CONSTRAINT "hint_events_session_id_practice_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."practice_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hint_events" ADD CONSTRAINT "hint_events_node_id_knowledge_nodes_id_fk" FOREIGN KEY ("node_id") REFERENCES "public"."knowledge_nodes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "hint_events_user_rule_idx" ON "hint_events" USING btree ("user_id","rule_id","created_at");--> statement-breakpoint
CREATE INDEX "hint_events_session_idx" ON "hint_events" USING btree ("session_id");