CREATE TYPE "public"."error_kind" AS ENUM('factual_slip', 'conceptual', 'transfer_failure', 'careless');--> statement-breakpoint
CREATE TABLE "response_diagnoses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"response_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"node_id" uuid NOT NULL,
	"kind" "error_kind" NOT NULL,
	"misconception" text,
	"evidence" text NOT NULL,
	"confidence" real DEFAULT 0.5 NOT NULL,
	"generated_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "response_diagnoses_confidence_range" CHECK ("response_diagnoses"."confidence" >= 0 AND "response_diagnoses"."confidence" <= 1)
);
--> statement-breakpoint
ALTER TABLE "response_diagnoses" ADD CONSTRAINT "response_diagnoses_response_id_user_responses_id_fk" FOREIGN KEY ("response_id") REFERENCES "public"."user_responses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "response_diagnoses" ADD CONSTRAINT "response_diagnoses_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "response_diagnoses" ADD CONSTRAINT "response_diagnoses_node_id_knowledge_nodes_id_fk" FOREIGN KEY ("node_id") REFERENCES "public"."knowledge_nodes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "response_diagnoses_response_uq" ON "response_diagnoses" USING btree ("response_id");--> statement-breakpoint
CREATE INDEX "response_diagnoses_user_node_idx" ON "response_diagnoses" USING btree ("user_id","node_id","created_at");--> statement-breakpoint
CREATE INDEX "response_diagnoses_kind_idx" ON "response_diagnoses" USING btree ("user_id","kind");