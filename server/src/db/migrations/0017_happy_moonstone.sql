CREATE TABLE "eval_case_expectations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"case_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"file" text NOT NULL,
	"start_line" integer NOT NULL,
	"end_line" integer NOT NULL,
	CONSTRAINT "eval_case_expectations_kind_check" CHECK ("eval_case_expectations"."kind" in ('must_find','must_not_flag')),
	CONSTRAINT "eval_case_expectations_end_line_check" CHECK ("eval_case_expectations"."end_line" >= "eval_case_expectations"."start_line")
);
--> statement-breakpoint
CREATE TABLE "eval_run_skills" (
	"suite_run_id" uuid NOT NULL,
	"skill_id" uuid NOT NULL,
	"skill_version" integer NOT NULL,
	"skill_name" text NOT NULL,
	"link_order" integer NOT NULL,
	CONSTRAINT "eval_run_skills_suite_run_id_skill_id_pk" PRIMARY KEY("suite_run_id","skill_id")
);
--> statement-breakpoint
CREATE TABLE "eval_suite_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"agent_id" uuid NOT NULL,
	"agent_version" integer NOT NULL,
	"status" text NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"cases_total" integer NOT NULL,
	"cases_completed" integer DEFAULT 0 NOT NULL,
	"cases_passed" integer,
	"cases_failed_to_complete" integer DEFAULT 0 NOT NULL,
	"recall" double precision,
	"precision" double precision,
	"citation_accuracy" double precision,
	"cost_usd" double precision,
	CONSTRAINT "eval_suite_runs_status_check" CHECK ("eval_suite_runs"."status" in ('running','completed','failed'))
);
--> statement-breakpoint
ALTER TABLE "eval_cases" ALTER COLUMN "input_diff" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "eval_cases" ADD COLUMN "source_finding_id" uuid;--> statement-breakpoint
ALTER TABLE "eval_cases" ADD COLUMN "file" text NOT NULL;--> statement-breakpoint
ALTER TABLE "eval_cases" ADD COLUMN "start_line" integer NOT NULL;--> statement-breakpoint
ALTER TABLE "eval_cases" ADD COLUMN "end_line" integer NOT NULL;--> statement-breakpoint
ALTER TABLE "eval_cases" ADD COLUMN "created_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "eval_cases" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "eval_runs" ADD COLUMN "suite_run_id" uuid;--> statement-breakpoint
ALTER TABLE "eval_runs" ADD COLUMN "error" text;--> statement-breakpoint
ALTER TABLE "eval_case_expectations" ADD CONSTRAINT "eval_case_expectations_case_id_eval_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."eval_cases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "eval_run_skills" ADD CONSTRAINT "eval_run_skills_suite_run_id_eval_suite_runs_id_fk" FOREIGN KEY ("suite_run_id") REFERENCES "public"."eval_suite_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "eval_suite_runs" ADD CONSTRAINT "eval_suite_runs_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "eval_suite_runs" ADD CONSTRAINT "eval_suite_runs_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "eval_case_expectations_case_idx" ON "eval_case_expectations" USING btree ("case_id");--> statement-breakpoint
CREATE INDEX "eval_run_skills_suite_run_idx" ON "eval_run_skills" USING btree ("suite_run_id");--> statement-breakpoint
CREATE UNIQUE INDEX "eval_one_running_per_agent" ON "eval_suite_runs" USING btree ("agent_id") WHERE "eval_suite_runs"."status" = 'running';--> statement-breakpoint
CREATE INDEX "eval_suite_runs_workspace_started_idx" ON "eval_suite_runs" USING btree ("workspace_id","started_at","id");--> statement-breakpoint
CREATE INDEX "eval_suite_runs_agent_started_idx" ON "eval_suite_runs" USING btree ("agent_id","started_at","id");--> statement-breakpoint
ALTER TABLE "eval_runs" ADD CONSTRAINT "eval_runs_suite_run_id_eval_suite_runs_id_fk" FOREIGN KEY ("suite_run_id") REFERENCES "public"."eval_suite_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "eval_case_finding_uq" ON "eval_cases" USING btree ("workspace_id","source_finding_id") WHERE "eval_cases"."source_finding_id" is not null and "eval_cases"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "eval_cases_owner_created_idx" ON "eval_cases" USING btree ("owner_id","created_at","id");--> statement-breakpoint
CREATE INDEX "eval_runs_suite_run_idx" ON "eval_runs" USING btree ("suite_run_id");