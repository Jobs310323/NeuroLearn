CREATE TABLE "note_embeddings" (
	"note_id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"content_hash" text NOT NULL,
	"model" text NOT NULL,
	"embedding" double precision[] NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "note_embeddings" ADD CONSTRAINT "note_embeddings_note_id_notes_id_fk" FOREIGN KEY ("note_id") REFERENCES "public"."notes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "note_embeddings" ADD CONSTRAINT "note_embeddings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "note_embeddings_user_idx" ON "note_embeddings" USING btree ("user_id");