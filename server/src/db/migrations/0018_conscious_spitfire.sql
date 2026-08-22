CREATE TABLE "eval_case_results" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"case_id" uuid,
	"ordinal" integer NOT NULL,
	"case_name" text NOT NULL,
	"case_repo_id" uuid,
	"case_input_diff" text NOT NULL,
	"case_expectations" jsonb NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"error" text,
	"findings" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"raw_findings_count" integer DEFAULT 0 NOT NULL,
	"expected_count" integer DEFAULT 0 NOT NULL,
	"matched_count" integer DEFAULT 0 NOT NULL,
	"cost_usd" double precision,
	"duration_ms" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "eval_suite_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"agent_id" uuid NOT NULL,
	"state" text DEFAULT 'pending' NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"system_prompt" text NOT NULL,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"strategy" text NOT NULL,
	"skills" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"captured_context" jsonb DEFAULT '{"documents":[],"excluded":[]}'::jsonb NOT NULL,
	"cases_total" integer DEFAULT 0 NOT NULL,
	"cases_done" integer DEFAULT 0 NOT NULL,
	"passed_count" integer DEFAULT 0 NOT NULL,
	"errored_count" integer DEFAULT 0 NOT NULL,
	"recall" double precision,
	"precision" double precision,
	"citation_accuracy" double precision,
	"cost_usd" double precision,
	"duration_ms" integer
);
--> statement-breakpoint
ALTER TABLE "eval_cases" ALTER COLUMN "input_diff" SET DEFAULT '';--> statement-breakpoint
ALTER TABLE "eval_cases" ALTER COLUMN "input_diff" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "eval_cases" ALTER COLUMN "expected_output" SET DEFAULT '[]'::jsonb;--> statement-breakpoint
ALTER TABLE "eval_cases" ALTER COLUMN "expected_output" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "eval_cases" ADD COLUMN "repo_id" uuid;--> statement-breakpoint
ALTER TABLE "eval_cases" ADD COLUMN "origin_finding_id" uuid;--> statement-breakpoint
ALTER TABLE "eval_cases" ADD COLUMN "origin_pr_id" uuid;--> statement-breakpoint
ALTER TABLE "eval_cases" ADD COLUMN "created_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "eval_cases" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "eval_case_results" ADD CONSTRAINT "eval_case_results_run_id_eval_suite_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."eval_suite_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "eval_case_results" ADD CONSTRAINT "eval_case_results_case_id_eval_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."eval_cases"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "eval_case_results" ADD CONSTRAINT "eval_case_results_case_repo_id_repos_id_fk" FOREIGN KEY ("case_repo_id") REFERENCES "public"."repos"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "eval_suite_runs" ADD CONSTRAINT "eval_suite_runs_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "eval_suite_runs" ADD CONSTRAINT "eval_suite_runs_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "eval_case_results_run_ordinal_uq" ON "eval_case_results" USING btree ("run_id","ordinal");--> statement-breakpoint
CREATE INDEX "eval_case_results_case_idx" ON "eval_case_results" USING btree ("case_id");--> statement-breakpoint
CREATE INDEX "eval_suite_runs_agent_started_idx" ON "eval_suite_runs" USING btree ("agent_id","started_at");--> statement-breakpoint
CREATE INDEX "eval_suite_runs_workspace_idx" ON "eval_suite_runs" USING btree ("workspace_id");--> statement-breakpoint
CREATE UNIQUE INDEX "eval_suite_runs_one_active_per_agent" ON "eval_suite_runs" USING btree ("agent_id") WHERE "eval_suite_runs"."state" in ('pending','running');--> statement-breakpoint
ALTER TABLE "eval_cases" ADD CONSTRAINT "eval_cases_repo_id_repos_id_fk" FOREIGN KEY ("repo_id") REFERENCES "public"."repos"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "eval_cases" ADD CONSTRAINT "eval_cases_origin_finding_id_findings_id_fk" FOREIGN KEY ("origin_finding_id") REFERENCES "public"."findings"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "eval_cases" ADD CONSTRAINT "eval_cases_origin_pr_id_pull_requests_id_fk" FOREIGN KEY ("origin_pr_id") REFERENCES "public"."pull_requests"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "eval_cases_owner_idx" ON "eval_cases" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "eval_cases_workspace_idx" ON "eval_cases" USING btree ("workspace_id");