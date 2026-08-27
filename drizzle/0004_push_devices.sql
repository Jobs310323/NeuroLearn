ALTER TABLE "push_subscriptions" ADD COLUMN "label" text;--> statement-breakpoint
ALTER TABLE "push_subscriptions" ADD COLUMN "user_agent" text;--> statement-breakpoint
CREATE INDEX "push_subscriptions_user_idx" ON "push_subscriptions" USING btree ("user_id","created_at");