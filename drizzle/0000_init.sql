CREATE TYPE "public"."agent_kind" AS ENUM('content_generator', 'tutor', 'progress_analyzer', 'metacognitive_coach');--> statement-breakpoint
CREATE TYPE "public"."assessment_type" AS ENUM('mcq', 'multi_select', 'cloze', 'short_answer', 'free_recall', 'ordering', 'matching', 'code', 'case_study', 'estimation');--> statement-breakpoint
CREATE TYPE "public"."cognitive_level" AS ENUM('recall', 'understand', 'apply', 'analyze', 'evaluate', 'create');--> statement-breakpoint
CREATE TYPE "public"."content_block_type" AS ENUM('pre_assessment', 'activation', 'concept', 'worked_example', 'contrast_cases', 'guided_practice', 'independent_practice', 'interleaved_practice', 'transfer_task', 'reflection');--> statement-breakpoint
CREATE TYPE "public"."context_scope" AS ENUM('global', 'path', 'node');--> statement-breakpoint
CREATE TYPE "public"."feedback_mode" AS ENUM('instant', 'delayed');--> statement-breakpoint
CREATE TYPE "public"."fsrs_rating" AS ENUM('again', 'hard', 'good', 'easy');--> statement-breakpoint
CREATE TYPE "public"."fsrs_state" AS ENUM('new', 'learning', 'review', 'relearning');--> statement-breakpoint
CREATE TYPE "public"."generation_status" AS ENUM('pending', 'succeeded', 'schema_failed', 'provider_failed');--> statement-breakpoint
CREATE TYPE "public"."message_role" AS ENUM('user', 'assistant', 'system', 'tool');--> statement-breakpoint
CREATE TYPE "public"."node_relation" AS ENUM('prerequisite', 'related', 'contrast', 'analogous');--> statement-breakpoint
CREATE TYPE "public"."node_status" AS ENUM('not_started', 'in_progress', 'mastered', 'needs_review', 'has_gaps', 'automated');--> statement-breakpoint
CREATE TYPE "public"."path_status" AS ENUM('draft', 'active', 'paused', 'completed', 'archived');--> statement-breakpoint
CREATE TYPE "public"."practice_mode" AS ENUM('pre_assessment', 'focused', 'interleaved', 'review', 'exam', 'remediation');--> statement-breakpoint
CREATE TYPE "public"."reflection_type" AS ENUM('pre_flight', 'post_module', 'error_analysis', 'weekly', 'project_defense');--> statement-breakpoint
CREATE TYPE "public"."submission_status" AS ENUM('draft', 'submitted', 'in_defense', 'revisions_requested', 'accepted');--> statement-breakpoint
CREATE TYPE "public"."source_kind" AS ENUM('pdf', 'markdown', 'plain_text', 'ai_notes', 'url', 'epub');--> statement-breakpoint
CREATE TYPE "public"."source_status" AS ENUM('uploaded', 'extracting', 'ready', 'failed');--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"display_name" text,
	"avatar_url" text,
	"timezone" text DEFAULT 'UTC' NOT NULL,
	"daily_goal_minutes" integer DEFAULT 20 NOT NULL,
	"cognitive_profile" jsonb DEFAULT '{"avgResponseTimeMs":null,"retentionIndex":null,"desirableDifficulty":"medium","calibrationBias":null,"interleavingTolerance":0.5,"preferredSessionMinutes":20}'::jsonb NOT NULL,
	"preferences" jsonb DEFAULT '{"locale":"ru","theme":"system","showScienceHints":true,"reduceMotion":false,"reviewRemindersEnabled":true,"requestRetention":0.9}'::jsonb NOT NULL,
	"onboarded_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "knowledge_nodes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"path_id" uuid NOT NULL,
	"parent_id" uuid,
	"slug" text NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"depth" integer DEFAULT 0 NOT NULL,
	"order_index" integer DEFAULT 0 NOT NULL,
	"weight" real DEFAULT 0.5 NOT NULL,
	"difficulty" real DEFAULT 0.5 NOT NULL,
	"status" "node_status" DEFAULT 'not_started' NOT NULL,
	"estimated_minutes" integer DEFAULT 20 NOT NULL,
	"content_ready" boolean DEFAULT false NOT NULL,
	"pos_x" double precision DEFAULT 0 NOT NULL,
	"pos_y" double precision DEFAULT 0 NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "knowledge_nodes_weight_range" CHECK ("knowledge_nodes"."weight" >= 0 AND "knowledge_nodes"."weight" <= 1),
	CONSTRAINT "knowledge_nodes_difficulty_range" CHECK ("knowledge_nodes"."difficulty" >= 0 AND "knowledge_nodes"."difficulty" <= 1),
	CONSTRAINT "knowledge_nodes_no_self_parent" CHECK ("knowledge_nodes"."parent_id" IS DISTINCT FROM "knowledge_nodes"."id")
);
--> statement-breakpoint
CREATE TABLE "learning_paths" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"title" text NOT NULL,
	"goal" text NOT NULL,
	"description" text,
	"target_level" text,
	"estimated_hours" integer,
	"status" "path_status" DEFAULT 'draft' NOT NULL,
	"generation_meta" jsonb,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "node_edges" (
	"source_id" uuid NOT NULL,
	"target_id" uuid NOT NULL,
	"relation" "node_relation" NOT NULL,
	"strength" real DEFAULT 0.5 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "node_edges_source_id_target_id_relation_pk" PRIMARY KEY("source_id","target_id","relation"),
	CONSTRAINT "node_edges_no_self_loop" CHECK ("node_edges"."source_id" <> "node_edges"."target_id"),
	CONSTRAINT "node_edges_strength_range" CHECK ("node_edges"."strength" >= 0 AND "node_edges"."strength" <= 1)
);
--> statement-breakpoint
CREATE TABLE "node_progress" (
	"node_id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"knowledge_strength" integer DEFAULT 0 NOT NULL,
	"automaticity_index" real DEFAULT 0 NOT NULL,
	"accuracy_rate" real DEFAULT 0 NOT NULL,
	"median_response_time_ms" integer,
	"total_reps" integer DEFAULT 0 NOT NULL,
	"total_practice_ms" integer DEFAULT 0 NOT NULL,
	"calibration_gap" real,
	"first_studied_at" timestamp with time zone,
	"mastered_at" timestamp with time zone,
	"automated_at" timestamp with time zone,
	"time_to_mastery_seconds" integer,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "node_progress_strength_range" CHECK ("node_progress"."knowledge_strength" >= 0 AND "node_progress"."knowledge_strength" <= 100)
);
--> statement-breakpoint
CREATE TABLE "assessments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"node_id" uuid NOT NULL,
	"content_block_id" uuid,
	"type" "assessment_type" NOT NULL,
	"cognitive_level" "cognitive_level" DEFAULT 'recall' NOT NULL,
	"prompt" text NOT NULL,
	"payload" jsonb NOT NULL,
	"correct_answer" jsonb NOT NULL,
	"explanation" text,
	"socratic_hints" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"feedback_mode" "feedback_mode" DEFAULT 'instant' NOT NULL,
	"instant_feedback" boolean DEFAULT true NOT NULL,
	"delayed_feedback" boolean DEFAULT false NOT NULL,
	"is_pre_assessment" boolean DEFAULT false NOT NULL,
	"difficulty" real DEFAULT 0.5 NOT NULL,
	"discrimination" real,
	"target_response_ms" integer,
	"variant_group_id" uuid,
	"context_label" text,
	"tags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "assessments_feedback_exclusive" CHECK ("assessments"."instant_feedback" <> "assessments"."delayed_feedback"),
	CONSTRAINT "assessments_feedback_mode_sync" CHECK (("assessments"."feedback_mode" = 'instant') = "assessments"."instant_feedback"),
	CONSTRAINT "assessments_difficulty_range" CHECK ("assessments"."difficulty" >= 0 AND "assessments"."difficulty" <= 1)
);
--> statement-breakpoint
CREATE TABLE "content_blocks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"node_id" uuid NOT NULL,
	"type" "content_block_type" NOT NULL,
	"title" text NOT NULL,
	"order_index" integer NOT NULL,
	"payload" jsonb NOT NULL,
	"pre_assessment" boolean DEFAULT false NOT NULL,
	"science_citation_key" text,
	"required" boolean DEFAULT true NOT NULL,
	"generated_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "content_blocks_pre_assessment_consistency" CHECK (("content_blocks"."type" = 'pre_assessment') = "content_blocks"."pre_assessment")
);
--> statement-breakpoint
CREATE TABLE "practice_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"path_id" uuid,
	"primary_node_id" uuid,
	"mode" "practice_mode" NOT NULL,
	"interleaved" boolean DEFAULT false NOT NULL,
	"config" jsonb NOT NULL,
	"item_order" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"item_count" integer DEFAULT 0 NOT NULL,
	"correct_count" integer DEFAULT 0 NOT NULL,
	"score" real,
	"duration_ms" integer,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "user_responses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"session_id" uuid,
	"assessment_id" uuid NOT NULL,
	"node_id" uuid NOT NULL,
	"response" jsonb NOT NULL,
	"is_correct" boolean NOT NULL,
	"partial_score" real DEFAULT 0 NOT NULL,
	"response_time_ms" integer NOT NULL,
	"confidence_level" integer,
	"retrieval_attempted" boolean DEFAULT true NOT NULL,
	"hints_used" integer DEFAULT 0 NOT NULL,
	"feedback_shown_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_responses_confidence_range" CHECK ("user_responses"."confidence_level" IS NULL OR ("user_responses"."confidence_level" >= 1 AND "user_responses"."confidence_level" <= 5)),
	CONSTRAINT "user_responses_partial_range" CHECK ("user_responses"."partial_score" >= 0 AND "user_responses"."partial_score" <= 1),
	CONSTRAINT "user_responses_time_positive" CHECK ("user_responses"."response_time_ms" >= 0)
);
--> statement-breakpoint
CREATE TABLE "fsrs_cards" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"node_id" uuid NOT NULL,
	"due" timestamp with time zone DEFAULT now() NOT NULL,
	"stability" real DEFAULT 0 NOT NULL,
	"difficulty" real DEFAULT 0 NOT NULL,
	"elapsed_days" integer DEFAULT 0 NOT NULL,
	"scheduled_days" integer DEFAULT 0 NOT NULL,
	"learning_steps" smallint DEFAULT 0 NOT NULL,
	"reps" integer DEFAULT 0 NOT NULL,
	"lapses" integer DEFAULT 0 NOT NULL,
	"state" "fsrs_state" DEFAULT 'new' NOT NULL,
	"last_review" timestamp with time zone,
	"suspended_until" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fsrs_cards_stability_positive" CHECK ("fsrs_cards"."stability" >= 0),
	CONSTRAINT "fsrs_cards_difficulty_range" CHECK ("fsrs_cards"."difficulty" >= 0 AND "fsrs_cards"."difficulty" <= 10)
);
--> statement-breakpoint
CREATE TABLE "review_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"card_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"session_id" uuid,
	"rating" "fsrs_rating" NOT NULL,
	"state" "fsrs_state" NOT NULL,
	"due" timestamp with time zone NOT NULL,
	"stability" real NOT NULL,
	"difficulty" real NOT NULL,
	"elapsed_days" integer NOT NULL,
	"last_elapsed_days" integer NOT NULL,
	"scheduled_days" integer NOT NULL,
	"learning_steps" smallint DEFAULT 0 NOT NULL,
	"reviewed_at" timestamp with time zone NOT NULL,
	"derived_from" smallint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reflections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"path_id" uuid,
	"node_id" uuid,
	"session_id" uuid,
	"type" "reflection_type" NOT NULL,
	"prompts" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"body" text NOT NULL,
	"self_assessment" jsonb,
	"calibration_delta" real,
	"depth_score" real,
	"coach_feedback" text,
	"word_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reflections_body_not_empty" CHECK (length(btrim("reflections"."body")) > 0)
);
--> statement-breakpoint
CREATE TABLE "ai_generations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"agent" "agent_kind" NOT NULL,
	"operation" text NOT NULL,
	"model" text NOT NULL,
	"prompt_version" text NOT NULL,
	"status" "generation_status" DEFAULT 'pending' NOT NULL,
	"validation_error" text,
	"retry_count" integer DEFAULT 0 NOT NULL,
	"tokens_in" integer,
	"tokens_out" integer,
	"cost_usd" real,
	"latency_ms" integer,
	"target_table" text,
	"target_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tutor_conversations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"node_id" uuid,
	"path_id" uuid,
	"title" text DEFAULT 'Диалог' NOT NULL,
	"memory_summary" text DEFAULT '' NOT NULL,
	"message_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tutor_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"conversation_id" uuid NOT NULL,
	"role" "message_role" NOT NULL,
	"content" text NOT NULL,
	"tool_calls" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"socratic_depth" integer DEFAULT 0 NOT NULL,
	"tokens_in" integer,
	"tokens_out" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_context" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"agent" "agent_kind" NOT NULL,
	"scope" "context_scope" NOT NULL,
	"path_id" uuid,
	"node_id" uuid,
	"summary" text DEFAULT '' NOT NULL,
	"facts" jsonb DEFAULT '{"strengths":[],"gaps":[],"misconceptions":[],"recommendedFocusNodeIds":[],"notes":""}'::jsonb NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_context_slot_uq" UNIQUE NULLS NOT DISTINCT("user_id","agent","scope","path_id","node_id")
);
--> statement-breakpoint
CREATE TABLE "project_submissions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"status" "submission_status" DEFAULT 'draft' NOT NULL,
	"artifact_url" text,
	"content" text,
	"defense_questions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"defense_conversation_id" uuid,
	"rubric_scores" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"defense_score" real,
	"revealed_gap_node_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"submitted_at" timestamp with time zone,
	"reviewed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "projects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"path_id" uuid NOT NULL,
	"node_id" uuid,
	"title" text NOT NULL,
	"brief" text NOT NULL,
	"covered_node_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"rubric" jsonb NOT NULL,
	"estimated_hours" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "node_sources" (
	"node_id" uuid NOT NULL,
	"chunk_id" uuid NOT NULL,
	"relevance" real DEFAULT 0.5 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "source_chunks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"document_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"order_index" integer NOT NULL,
	"heading_path" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"content" text NOT NULL,
	"char_count" integer NOT NULL,
	"page_number" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "source_chunks_content_not_empty" CHECK (length(btrim("source_chunks"."content")) > 0)
);
--> statement-breakpoint
CREATE TABLE "source_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"path_id" uuid,
	"title" text NOT NULL,
	"kind" "source_kind" NOT NULL,
	"status" "source_status" DEFAULT 'uploaded' NOT NULL,
	"original_filename" text,
	"source_url" text,
	"author" text,
	"char_count" integer DEFAULT 0 NOT NULL,
	"chunk_count" integer DEFAULT 0 NOT NULL,
	"failure_reason" text,
	"meta" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "knowledge_nodes" ADD CONSTRAINT "knowledge_nodes_path_id_learning_paths_id_fk" FOREIGN KEY ("path_id") REFERENCES "public"."learning_paths"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_nodes" ADD CONSTRAINT "knowledge_nodes_parent_id_knowledge_nodes_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."knowledge_nodes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learning_paths" ADD CONSTRAINT "learning_paths_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "node_edges" ADD CONSTRAINT "node_edges_source_id_knowledge_nodes_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."knowledge_nodes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "node_edges" ADD CONSTRAINT "node_edges_target_id_knowledge_nodes_id_fk" FOREIGN KEY ("target_id") REFERENCES "public"."knowledge_nodes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "node_progress" ADD CONSTRAINT "node_progress_node_id_knowledge_nodes_id_fk" FOREIGN KEY ("node_id") REFERENCES "public"."knowledge_nodes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "node_progress" ADD CONSTRAINT "node_progress_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assessments" ADD CONSTRAINT "assessments_node_id_knowledge_nodes_id_fk" FOREIGN KEY ("node_id") REFERENCES "public"."knowledge_nodes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assessments" ADD CONSTRAINT "assessments_content_block_id_content_blocks_id_fk" FOREIGN KEY ("content_block_id") REFERENCES "public"."content_blocks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_blocks" ADD CONSTRAINT "content_blocks_node_id_knowledge_nodes_id_fk" FOREIGN KEY ("node_id") REFERENCES "public"."knowledge_nodes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "practice_sessions" ADD CONSTRAINT "practice_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "practice_sessions" ADD CONSTRAINT "practice_sessions_path_id_learning_paths_id_fk" FOREIGN KEY ("path_id") REFERENCES "public"."learning_paths"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "practice_sessions" ADD CONSTRAINT "practice_sessions_primary_node_id_knowledge_nodes_id_fk" FOREIGN KEY ("primary_node_id") REFERENCES "public"."knowledge_nodes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_responses" ADD CONSTRAINT "user_responses_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_responses" ADD CONSTRAINT "user_responses_session_id_practice_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."practice_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_responses" ADD CONSTRAINT "user_responses_assessment_id_assessments_id_fk" FOREIGN KEY ("assessment_id") REFERENCES "public"."assessments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_responses" ADD CONSTRAINT "user_responses_node_id_knowledge_nodes_id_fk" FOREIGN KEY ("node_id") REFERENCES "public"."knowledge_nodes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fsrs_cards" ADD CONSTRAINT "fsrs_cards_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fsrs_cards" ADD CONSTRAINT "fsrs_cards_node_id_knowledge_nodes_id_fk" FOREIGN KEY ("node_id") REFERENCES "public"."knowledge_nodes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_logs" ADD CONSTRAINT "review_logs_card_id_fsrs_cards_id_fk" FOREIGN KEY ("card_id") REFERENCES "public"."fsrs_cards"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_logs" ADD CONSTRAINT "review_logs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_logs" ADD CONSTRAINT "review_logs_session_id_practice_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."practice_sessions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reflections" ADD CONSTRAINT "reflections_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reflections" ADD CONSTRAINT "reflections_path_id_learning_paths_id_fk" FOREIGN KEY ("path_id") REFERENCES "public"."learning_paths"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reflections" ADD CONSTRAINT "reflections_node_id_knowledge_nodes_id_fk" FOREIGN KEY ("node_id") REFERENCES "public"."knowledge_nodes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reflections" ADD CONSTRAINT "reflections_session_id_practice_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."practice_sessions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_generations" ADD CONSTRAINT "ai_generations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tutor_conversations" ADD CONSTRAINT "tutor_conversations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tutor_conversations" ADD CONSTRAINT "tutor_conversations_node_id_knowledge_nodes_id_fk" FOREIGN KEY ("node_id") REFERENCES "public"."knowledge_nodes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tutor_conversations" ADD CONSTRAINT "tutor_conversations_path_id_learning_paths_id_fk" FOREIGN KEY ("path_id") REFERENCES "public"."learning_paths"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tutor_messages" ADD CONSTRAINT "tutor_messages_conversation_id_tutor_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."tutor_conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_context" ADD CONSTRAINT "user_context_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_context" ADD CONSTRAINT "user_context_path_id_learning_paths_id_fk" FOREIGN KEY ("path_id") REFERENCES "public"."learning_paths"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_context" ADD CONSTRAINT "user_context_node_id_knowledge_nodes_id_fk" FOREIGN KEY ("node_id") REFERENCES "public"."knowledge_nodes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_submissions" ADD CONSTRAINT "project_submissions_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_submissions" ADD CONSTRAINT "project_submissions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_path_id_learning_paths_id_fk" FOREIGN KEY ("path_id") REFERENCES "public"."learning_paths"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_node_id_knowledge_nodes_id_fk" FOREIGN KEY ("node_id") REFERENCES "public"."knowledge_nodes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "node_sources" ADD CONSTRAINT "node_sources_node_id_knowledge_nodes_id_fk" FOREIGN KEY ("node_id") REFERENCES "public"."knowledge_nodes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "node_sources" ADD CONSTRAINT "node_sources_chunk_id_source_chunks_id_fk" FOREIGN KEY ("chunk_id") REFERENCES "public"."source_chunks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_chunks" ADD CONSTRAINT "source_chunks_document_id_source_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."source_documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_chunks" ADD CONSTRAINT "source_chunks_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_documents" ADD CONSTRAINT "source_documents_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_documents" ADD CONSTRAINT "source_documents_path_id_learning_paths_id_fk" FOREIGN KEY ("path_id") REFERENCES "public"."learning_paths"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "knowledge_nodes_path_slug_uq" ON "knowledge_nodes" USING btree ("path_id","slug");--> statement-breakpoint
CREATE INDEX "knowledge_nodes_path_parent_idx" ON "knowledge_nodes" USING btree ("path_id","parent_id");--> statement-breakpoint
CREATE INDEX "knowledge_nodes_status_idx" ON "knowledge_nodes" USING btree ("path_id","status");--> statement-breakpoint
CREATE INDEX "learning_paths_user_status_idx" ON "learning_paths" USING btree ("user_id","status");--> statement-breakpoint
CREATE INDEX "node_edges_target_idx" ON "node_edges" USING btree ("target_id","relation");--> statement-breakpoint
CREATE INDEX "node_progress_user_idx" ON "node_progress" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "node_progress_strength_idx" ON "node_progress" USING btree ("user_id","knowledge_strength");--> statement-breakpoint
CREATE INDEX "assessments_node_active_idx" ON "assessments" USING btree ("node_id","active");--> statement-breakpoint
CREATE INDEX "assessments_variant_group_idx" ON "assessments" USING btree ("variant_group_id");--> statement-breakpoint
CREATE INDEX "assessments_pre_idx" ON "assessments" USING btree ("node_id","is_pre_assessment");--> statement-breakpoint
CREATE UNIQUE INDEX "content_blocks_node_order_uq" ON "content_blocks" USING btree ("node_id","order_index");--> statement-breakpoint
CREATE INDEX "content_blocks_node_type_idx" ON "content_blocks" USING btree ("node_id","type");--> statement-breakpoint
CREATE INDEX "practice_sessions_user_started_idx" ON "practice_sessions" USING btree ("user_id","started_at");--> statement-breakpoint
CREATE INDEX "practice_sessions_open_idx" ON "practice_sessions" USING btree ("user_id","completed_at") WHERE "practice_sessions"."completed_at" IS NULL;--> statement-breakpoint
CREATE INDEX "user_responses_user_node_idx" ON "user_responses" USING btree ("user_id","node_id","created_at");--> statement-breakpoint
CREATE INDEX "user_responses_assessment_idx" ON "user_responses" USING btree ("assessment_id");--> statement-breakpoint
CREATE INDEX "user_responses_session_idx" ON "user_responses" USING btree ("session_id");--> statement-breakpoint
CREATE UNIQUE INDEX "fsrs_cards_user_node_uq" ON "fsrs_cards" USING btree ("user_id","node_id");--> statement-breakpoint
CREATE INDEX "fsrs_cards_due_idx" ON "fsrs_cards" USING btree ("user_id","due");--> statement-breakpoint
CREATE INDEX "review_logs_card_idx" ON "review_logs" USING btree ("card_id","reviewed_at");--> statement-breakpoint
CREATE INDEX "review_logs_user_idx" ON "review_logs" USING btree ("user_id","reviewed_at");--> statement-breakpoint
CREATE INDEX "reflections_user_created_idx" ON "reflections" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "reflections_node_type_idx" ON "reflections" USING btree ("node_id","type");--> statement-breakpoint
CREATE INDEX "ai_generations_user_created_idx" ON "ai_generations" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "ai_generations_status_idx" ON "ai_generations" USING btree ("status","operation");--> statement-breakpoint
CREATE INDEX "tutor_conversations_user_idx" ON "tutor_conversations" USING btree ("user_id","updated_at");--> statement-breakpoint
CREATE INDEX "tutor_messages_conversation_idx" ON "tutor_messages" USING btree ("conversation_id","created_at");--> statement-breakpoint
CREATE INDEX "user_context_user_agent_idx" ON "user_context" USING btree ("user_id","agent");--> statement-breakpoint
CREATE INDEX "project_submissions_user_idx" ON "project_submissions" USING btree ("user_id","status");--> statement-breakpoint
CREATE INDEX "project_submissions_project_idx" ON "project_submissions" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "projects_path_idx" ON "projects" USING btree ("path_id");--> statement-breakpoint
CREATE INDEX "node_sources_node_idx" ON "node_sources" USING btree ("node_id");--> statement-breakpoint
CREATE INDEX "node_sources_chunk_idx" ON "node_sources" USING btree ("chunk_id");--> statement-breakpoint
CREATE INDEX "source_chunks_document_idx" ON "source_chunks" USING btree ("document_id","order_index");--> statement-breakpoint
CREATE INDEX "source_chunks_user_idx" ON "source_chunks" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "source_documents_user_idx" ON "source_documents" USING btree ("user_id","created_at");