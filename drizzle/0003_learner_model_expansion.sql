CREATE TYPE "public"."experiment_arm" AS ENUM('a', 'b');--> statement-breakpoint
CREATE TYPE "public"."experiment_status" AS ENUM('draft', 'running', 'completed', 'aborted');--> statement-breakpoint
CREATE TABLE "learning_experiment_assignments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"experiment_id" uuid NOT NULL,
	"node_id" uuid NOT NULL,
	"arm" "experiment_arm" NOT NULL,
	"assigned_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "learning_experiments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"hypothesis" text NOT NULL,
	"variable" text NOT NULL,
	"arm_a" jsonb NOT NULL,
	"arm_b" jsonb NOT NULL,
	"metric" text NOT NULL,
	"window_days" integer DEFAULT 7 NOT NULL,
	"status" "experiment_status" DEFAULT 'draft' NOT NULL,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "learning_experiments_window_positive" CHECK ("learning_experiments"."window_days" >= 1)
);
--> statement-breakpoint
CREATE TABLE "push_subscriptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"endpoint" text NOT NULL,
	"p256dh" text NOT NULL,
	"auth" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "user_responses" ADD COLUMN "jok_level" integer;--> statement-breakpoint
ALTER TABLE "learning_experiment_assignments" ADD CONSTRAINT "learning_experiment_assignments_experiment_id_learning_experiments_id_fk" FOREIGN KEY ("experiment_id") REFERENCES "public"."learning_experiments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learning_experiment_assignments" ADD CONSTRAINT "learning_experiment_assignments_node_id_knowledge_nodes_id_fk" FOREIGN KEY ("node_id") REFERENCES "public"."knowledge_nodes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learning_experiments" ADD CONSTRAINT "learning_experiments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "push_subscriptions" ADD CONSTRAINT "push_subscriptions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "experiment_assignments_experiment_node_uq" ON "learning_experiment_assignments" USING btree ("experiment_id","node_id");--> statement-breakpoint
CREATE INDEX "experiment_assignments_node_idx" ON "learning_experiment_assignments" USING btree ("node_id");--> statement-breakpoint
CREATE INDEX "learning_experiments_user_status_idx" ON "learning_experiments" USING btree ("user_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "push_subscriptions_endpoint_uq" ON "push_subscriptions" USING btree ("endpoint");--> statement-breakpoint
ALTER TABLE "user_responses" ADD CONSTRAINT "user_responses_jok_range" CHECK ("user_responses"."jok_level" IS NULL OR ("user_responses"."jok_level" >= 1 AND "user_responses"."jok_level" <= 5));