-- Deduplicate before the unique index: keep the oldest case per finding.
DELETE FROM "eval_cases" a
USING "eval_cases" b
WHERE a.origin_finding_id IS NOT NULL
  AND a.origin_finding_id = b.origin_finding_id
  AND a.created_at > b.created_at;

DELETE FROM "eval_cases" a
USING "eval_cases" b
WHERE a.origin_finding_id IS NOT NULL
  AND a.origin_finding_id = b.origin_finding_id
  AND a.created_at = b.created_at
  AND a.id > b.id;

CREATE UNIQUE INDEX "eval_cases_origin_finding_uq" ON "eval_cases" USING btree ("origin_finding_id") WHERE "eval_cases"."origin_finding_id" is not null;
