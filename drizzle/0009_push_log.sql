CREATE TYPE "public"."push_category" AS ENUM('review_due', 'node_weak', 'experiment_ready', 'note_capsule');--> statement-breakpoint
CREATE TABLE "push_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"category" "push_category" NOT NULL,
	"delivered" boolean DEFAULT true NOT NULL,
	"sent_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "push_log" ADD CONSTRAINT "push_log_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "push_log_user_sent_idx" ON "push_log" USING btree ("user_id","category","sent_at");