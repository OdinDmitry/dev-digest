ALTER TABLE "eval_cases" ADD COLUMN "severity" text;--> statement-breakpoint
ALTER TABLE "eval_cases" ADD COLUMN "category" text;--> statement-breakpoint
ALTER TABLE "eval_cases" ADD COLUMN "latest_result" jsonb;