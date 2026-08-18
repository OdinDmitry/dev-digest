ALTER TABLE "pr_brief" ADD COLUMN "head_sha" text NOT NULL;--> statement-breakpoint
ALTER TABLE "pr_brief" ADD COLUMN "created_at" timestamp with time zone DEFAULT now() NOT NULL;