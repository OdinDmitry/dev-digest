/**
 * T28 / D27 — case-lifecycle integration tests over a real Postgres
 * (testcontainers). `secrets: new MockSecretsProvider()` in every `appWith()`
 * override keeps every adapter resolved through `SecretsProvider` from
 * reaching the real network (`server/insights.md` 2026-08-17 — a directly
 * injected `llm` skips the key lookup, but nothing else here needs a real
 * LLM call, so a plain unused counting provider is enough).
 *
 * SPEC-04 delta (D27): the expectation type is DERIVED from the finding's own
 * decision, never sent on the wire (AC-40, AC-41) — every `POST
 * .../eval-cases` payload below carries only `finding_id`/`name`. A case now
 * also copies the finding's `severity`/`category` at creation (AC-44), and
 * `PUT /eval-cases/:id` accepts only a name (AC-45) — the retired
 * `eval_overlapping_expectations_are_rejected` (AC-11) is deleted, not
 * rewritten (D23; plan's Retirement traceability table).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import type { LLMProvider, StructuredRequest, StructuredResult } from '@devdigest/shared';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import { MockSecretsProvider } from '../src/adapters/mocks.js';
import * as t from '../src/db/schema.js';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

if (!hasDocker) {
  // eslint-disable-next-line no-console
  console.warn('[eval-cases] Docker not available — skipping integration tests.');
}

const config = () => loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

/** Never invoked by anything in this file — case CRUD makes zero model calls. */
const UNUSED_LLM: LLMProvider = {
  id: 'openai',
  async completeStructured<T>(_req: StructuredRequest<T>): Promise<StructuredResult<T>> {
    throw new Error('eval-cases.it.test.ts: no model call is expected on this path');
  },
  async listModels() {
    return [];
  },
  async complete() {
    throw new Error('not used in these tests');
  },
  async embed() {
    return [];
  },
};

const CONFIG_PATCH = [
  '@@ -9,3 +9,7 @@',
  ' const config = {',
  '   port: process.env.PORT || 3000,',
  "   apiVersion: 'v2',",
  "+  stripeSecretKey: 'sk_live_51Hxxxxxxxxxxxxxxxxxxxxxxxx',",
  '+  rateLimit: { windowMs: 60_000, max: 100 },',
  '+  retries: 3,',
  '+  timeout: 5000,',
].join('\n');

/** New-side range [118, 142] — fully contains the normalized [123, 130]
 *  range a `start_line=130, end_line=123` finding (the real reproducing
 *  shape, `server/insights.md` 2026-08-21) normalizes to. */
const INVERTED_RANGE_PATCH = [
  '@@ -112,20 +118,25 @@',
  ' function reviewCandidate(pr) {',
  "+  const marker = 'inverted-range-fixture';",
  '   return true;',
  ' }',
].join('\n');

d('modules/eval — case lifecycle (Postgres)', () => {
  let pg: PgFixture;
  let workspaceId: string;
  let seq = 0;

  beforeAll(async () => {
    pg = await startPg();
    await seed(pg.handle.db);
    const [ws] = await pg.handle.db.select().from(t.workspaces);
    workspaceId = ws!.id;
  });
  afterAll(async () => {
    await pg?.stop();
  });

  function appWith() {
    return buildApp({
      config: config(),
      db: pg.handle.db,
      overrides: { secrets: new MockSecretsProvider(), llm: { openai: UNUSED_LLM } },
    });
  }

  async function createAgent(app: Awaited<ReturnType<typeof buildApp>>, over: Record<string, unknown> = {}) {
    const res = await app.inject({
      method: 'POST',
      url: '/agents',
      payload: {
        name: `agent-${Math.random().toString(36).slice(2, 8)}`,
        provider: 'openai',
        model: 'gpt-4o-mini',
        system_prompt: 'Review the diff.',
        ...over,
      },
    });
    expect(res.statusCode).toBe(201);
    return res.json() as { id: string };
  }

  /** A repo + PR + one review (owned by `agent`) + one finding, with a
   *  patch covering the finding's exact range so its fragment can be cut. */
  async function setupFinding(
    agentId: string,
    opts: {
      decision?: 'accepted' | 'dismissed' | 'none';
      patch?: string | null;
      startLine?: number;
      endLine?: number;
    } = {},
  ) {
    const n = seq++;
    const name = `eval-repo-${n}`;
    const [repo] = await pg.handle.db
      .insert(t.repos)
      .values({ workspaceId, owner: 'acme', name, fullName: `acme/${name}` })
      .returning();
    const [pr] = await pg.handle.db
      .insert(t.pullRequests)
      .values({
        workspaceId,
        repoId: repo!.id,
        number: 2000 + n,
        title: 'Add config keys',
        author: 'tester',
        branch: 'feat/config',
        base: 'main',
        headSha: `headsha-${n}`,
        additions: 4,
        deletions: 0,
        filesCount: 1,
        status: 'needs_review',
      })
      .returning();
    const patch = opts.patch === undefined ? CONFIG_PATCH : opts.patch;
    await pg.handle.db
      .insert(t.prFiles)
      .values({ prId: pr!.id, path: 'src/config.ts', additions: 4, deletions: 0, patch });

    const [review] = await pg.handle.db
      .insert(t.reviews)
      .values({
        workspaceId,
        prId: pr!.id,
        agentId,
        kind: 'review',
        verdict: 'request_changes',
        summary: 'seeded review',
        score: 50,
        model: 'seed',
      })
      .returning();

    const decision = opts.decision ?? 'accepted';
    const [finding] = await pg.handle.db
      .insert(t.findings)
      .values({
        reviewId: review!.id,
        file: 'src/config.ts',
        startLine: opts.startLine ?? 12,
        endLine: opts.endLine ?? 12,
        severity: 'CRITICAL',
        category: 'security',
        title: 'Hardcoded Stripe secret key',
        rationale: 'A live secret key is committed in plaintext.',
        confidence: 0.98,
        ...(decision === 'accepted' ? { acceptedAt: new Date() } : {}),
        ...(decision === 'dismissed' ? { dismissedAt: new Date() } : {}),
      })
      .returning();

    return { repo: repo!, pr: pr!, review: review!, finding: finding! };
  }

  it('eval_draft_carries_file_range_and_fragment', async () => {
    const app = await appWith();
    const agent = await createAgent(app);
    const { finding } = await setupFinding(agent.id, { decision: 'accepted' });

    const res = await app.inject({ method: 'GET', url: `/findings/${finding.id}/eval-case-draft` });
    expect(res.statusCode).toBe(200);
    const draft = res.json();

    expect(draft.file).toBe('src/config.ts');
    expect(draft.start_line).toBe(12);
    expect(draft.end_line).toBe(12);
    expect(draft.fragment).toContain('stripeSecretKey');
    expect(draft.agent_id).toBe(agent.id);
    // `expectation_kind` REPLACES `default_expectation_kind` (AC-40, AC-41):
    // derived from the finding's decision, not offered as a default to
    // override — accepted → must_find.
    expect(draft.expectation_kind).toBe('must_find');
    expect(draft.existing_case).toBeNull();
    await app.close();
  });

  it('eval_create_stores_case_for_the_finding_agent', async () => {
    const app = await appWith();
    const agent = await createAgent(app);
    const { finding } = await setupFinding(agent.id, { decision: 'accepted' });

    // No `expectation_kind` on the wire at all (AC-40, AC-41, AC-43) — a bare
    // finding id + name is a complete create payload.
    const res = await app.inject({
      method: 'POST',
      url: `/agents/${agent.id}/eval-cases`,
      payload: { finding_id: finding.id, name: 'Stripe key must be flagged' },
    });
    expect(res.statusCode).toBe(201);
    const created = res.json();
    expect(created.agent_id).toBe(agent.id);
    expect(created.file).toBe('src/config.ts');
    expect(created.start_line).toBe(12);
    expect(created.end_line).toBe(12);
    expect(created.expectations).toHaveLength(1);
    expect(created.expectations[0].kind).toBe('must_find');
    expect(created.fragment).toContain('stripeSecretKey');

    const listRes = await app.inject({ method: 'GET', url: `/agents/${agent.id}/eval-cases` });
    expect(listRes.statusCode).toBe(200);
    expect((listRes.json() as { id: string }[]).map((c) => c.id)).toContain(created.id);
    await app.close();
  });

  it('eval_case_kind_is_derived_from_the_finding_decision', async () => {
    const app = await appWith();
    const agent = await createAgent(app);

    const { finding: acceptedFinding } = await setupFinding(agent.id, {
      decision: 'accepted',
      startLine: 12,
      endLine: 12,
    });
    const acceptedRes = await app.inject({
      method: 'POST',
      url: `/agents/${agent.id}/eval-cases`,
      payload: { finding_id: acceptedFinding.id, name: 'Accepted → must_find' },
    });
    expect(acceptedRes.statusCode).toBe(201);
    expect(acceptedRes.json().expectations[0].kind).toBe('must_find');

    const { finding: dismissedFinding } = await setupFinding(agent.id, {
      decision: 'dismissed',
      startLine: 12,
      endLine: 12,
    });
    const dismissedRes = await app.inject({
      method: 'POST',
      url: `/agents/${agent.id}/eval-cases`,
      payload: { finding_id: dismissedFinding.id, name: 'Dismissed → must_not_flag' },
    });
    expect(dismissedRes.statusCode).toBe(201);
    expect(dismissedRes.json().expectations[0].kind).toBe('must_not_flag');
    await app.close();
  });

  it('eval_create_refuses_a_finding_with_no_decision', async () => {
    const app = await appWith();
    const agent = await createAgent(app);
    const { finding } = await setupFinding(agent.id, { decision: 'none' });

    const res = await app.inject({
      method: 'POST',
      url: `/agents/${agent.id}/eval-cases`,
      payload: { finding_id: finding.id, name: 'No decision yet' },
    });
    expect(res.statusCode).toBe(422);
    const body = res.json();
    expect(body.error.message).toMatch(/accepted or dismissed/i);

    // No case was actually created for this finding.
    const listRes = await app.inject({ method: 'GET', url: `/agents/${agent.id}/eval-cases` });
    const names = (listRes.json() as { name: string }[]).map((c) => c.name);
    expect(names).not.toContain('No decision yet');
    await app.close();
  });

  it('eval_case_captures_the_finding_severity_and_category', async () => {
    const app = await appWith();
    const agent = await createAgent(app);
    const { finding } = await setupFinding(agent.id, { decision: 'accepted' });
    // The seeded finding (setupFinding) is severity='CRITICAL', category='security'.

    const res = await app.inject({
      method: 'POST',
      url: `/agents/${agent.id}/eval-cases`,
      payload: { finding_id: finding.id, name: 'Carries severity and category' },
    });
    expect(res.statusCode).toBe(201);
    const created = res.json();
    expect(created.severity).toBe('CRITICAL');
    expect(created.category).toBe('security');

    // Persisted, not just returned on the create response.
    const listRes = await app.inject({ method: 'GET', url: `/agents/${agent.id}/eval-cases` });
    const stored = (listRes.json() as { id: string; severity: string; category: string }[]).find(
      (c) => c.id === created.id,
    );
    expect(stored!.severity).toBe('CRITICAL');
    expect(stored!.category).toBe('security');
    await app.close();
  });

  it('eval_draft_and_create_normalize_an_inverted_finding_range', async () => {
    // Reproduces the real defect: a finding whose own start_line/end_line is
    // inverted (start_line=130, end_line=123 — `server/insights.md`
    // 2026-08-21) used to make POST violate
    // `eval_case_expectations_end_line_check` (`CHECK (end_line >= start_line)`).
    const app = await appWith();
    const agent = await createAgent(app);
    const { finding } = await setupFinding(agent.id, {
      decision: 'accepted',
      patch: INVERTED_RANGE_PATCH,
      startLine: 130,
      endLine: 123,
    });

    // The draft (GET) comes back well-ordered.
    const draftRes = await app.inject({ method: 'GET', url: `/findings/${finding.id}/eval-case-draft` });
    expect(draftRes.statusCode).toBe(200);
    const draft = draftRes.json();
    expect(draft.start_line).toBe(123);
    expect(draft.end_line).toBe(130);
    expect(draft.fragment).toContain('inverted-range-fixture');

    // Creating the case from it does NOT raise the CHECK constraint
    // violation, and persists a well-ordered range on both the case row and
    // its seeded expectation — not just "no error was thrown".
    const createRes = await app.inject({
      method: 'POST',
      url: `/agents/${agent.id}/eval-cases`,
      payload: { finding_id: finding.id, name: 'Inverted range case' },
    });
    expect(createRes.statusCode).toBe(201);
    const created = createRes.json();
    expect(created.start_line).toBe(123);
    expect(created.end_line).toBe(130);
    expect(created.expectations).toHaveLength(1);
    expect(created.expectations[0].start_line).toBe(123);
    expect(created.expectations[0].end_line).toBe(130);

    // The persisted expectation row itself — the exact row the CHECK
    // constraint guards — is well-ordered, proving the constraint is intact
    // and was satisfied rather than relaxed.
    const [rawExpectation] = await pg.handle.db
      .select()
      .from(t.evalCaseExpectations)
      .where(eq(t.evalCaseExpectations.caseId, created.id));
    expect(rawExpectation).toBeDefined();
    expect(rawExpectation!.startLine).toBe(123);
    expect(rawExpectation!.endLine).toBe(130);
    await app.close();
  });

  it('eval_case_is_immutable_when_its_finding_changes', async () => {
    const app = await appWith();
    const agent = await createAgent(app);
    const { finding } = await setupFinding(agent.id, { decision: 'accepted' });

    const created = await app
      .inject({
        method: 'POST',
        url: `/agents/${agent.id}/eval-cases`,
        payload: { finding_id: finding.id, name: 'Stripe key case' },
      })
      .then((r) => r.json());
    const originalFragment = created.fragment;
    const originalFile = created.file;
    const originalStart = created.start_line;
    const originalEnd = created.end_line;
    const originalKind = created.expectations[0].kind;
    const originalSeverity = created.severity;
    const originalCategory = created.category;
    expect(originalSeverity).toBe('CRITICAL');
    expect(originalCategory).toBe('security');

    // Re-decide the finding (dismiss it, after it was accepted)…
    await pg.handle.db
      .update(t.findings)
      .set({ dismissedAt: new Date(), acceptedAt: null })
      .where(eq(t.findings.id, finding.id));
    // …edit its file/range/severity/category…
    await pg.handle.db
      .update(t.findings)
      .set({ file: 'src/other.ts', startLine: 99, endLine: 100, severity: 'WARNING', category: 'style' })
      .where(eq(t.findings.id, finding.id));
    // …and delete the finding outright.
    await pg.handle.db.delete(t.findings).where(eq(t.findings.id, finding.id));

    const reread = await app
      .inject({ method: 'GET', url: `/agents/${agent.id}/eval-cases` })
      .then(
        (r) =>
          r.json() as {
            id: string;
            fragment: string;
            file: string;
            start_line: number;
            end_line: number;
            severity: string | null;
            category: string | null;
            expectations: { kind: string }[];
          }[],
      );
    const stillThere = reread.find((c) => c.id === created.id);
    expect(stillThere).toBeDefined();
    expect(stillThere!.fragment).toBe(originalFragment);
    expect(stillThere!.file).toBe(originalFile);
    expect(stillThere!.start_line).toBe(originalStart);
    expect(stillThere!.end_line).toBe(originalEnd);
    expect(stillThere!.expectations[0]!.kind).toBe(originalKind);
    // AC-45's SPEC-04 extension: severity and category are captured at
    // creation and never move, even after the finding's own values do.
    expect(stillThere!.severity).toBe(originalSeverity);
    expect(stillThere!.category).toBe(originalCategory);
    await app.close();
  });

  it('eval_second_conversion_returns_the_existing_case', async () => {
    const app = await appWith();
    const agent = await createAgent(app);
    const { finding } = await setupFinding(agent.id, { decision: 'accepted' });

    const first = await app.inject({
      method: 'POST',
      url: `/agents/${agent.id}/eval-cases`,
      payload: { finding_id: finding.id, name: 'First name' },
    });
    expect(first.statusCode).toBe(201);
    const firstCase = first.json();

    const second = await app.inject({
      method: 'POST',
      url: `/agents/${agent.id}/eval-cases`,
      payload: { finding_id: finding.id, name: 'A different name' },
    });
    expect(second.statusCode).toBe(200); // NOT 201 — no second case created
    expect(second.json().id).toBe(firstCase.id);
    expect(second.json().name).toBe(firstCase.name); // the FIRST case, unchanged

    const rows = await pg.handle.db
      .select()
      .from(t.evalCases)
      .where(eq(t.evalCases.sourceFindingId, finding.id));
    expect(rows).toHaveLength(1);
    await app.close();
  });

  it('eval_case_row_created_before_severity_capture_reads_as_unavailable', async () => {
    // Builds its fixture in the OLD shape — a raw `eval_cases` row inserted
    // directly, exactly as a row created before SPEC-04 looks on disk:
    // severity/category/latest_result all NULL (AC-52, AC-54 edge case).
    const app = await appWith();
    const agent = await createAgent(app);
    const [legacyCase] = await pg.handle.db
      .insert(t.evalCases)
      .values({
        workspaceId,
        ownerKind: 'agent',
        ownerId: agent.id,
        name: 'legacy-case-no-severity',
        inputDiff: CONFIG_PATCH,
        file: 'src/config.ts',
        startLine: 12,
        endLine: 12,
        // severity/category/latestResult intentionally omitted — NULL.
      })
      .returning();
    await pg.handle.db.insert(t.evalCaseExpectations).values({
      caseId: legacyCase!.id,
      kind: 'must_find',
      file: 'src/config.ts',
      startLine: 12,
      endLine: 12,
    });

    const res = await app.inject({ method: 'GET', url: `/agents/${agent.id}/eval-cases` });
    expect(res.statusCode).toBe(200); // does NOT throw and does NOT default
    const found = (
      res.json() as { id: string; severity: string | null; category: string | null; latest_result: unknown }[]
    ).find((c) => c.id === legacyCase!.id);
    expect(found).toBeDefined();
    expect(found!.severity).toBeNull();
    expect(found!.category).toBeNull();
    expect(found!.latest_result).toBeNull();
    await app.close();
  });

  it('eval_edit_and_delete_leave_recorded_runs_unchanged', async () => {
    const app = await appWith();
    const agent = await createAgent(app);
    const { finding } = await setupFinding(agent.id, { decision: 'accepted' });

    const created = await app
      .inject({
        method: 'POST',
        url: `/agents/${agent.id}/eval-cases`,
        payload: { finding_id: finding.id, name: 'Stripe key case' },
      })
      .then((r) => r.json());

    // A completed suite run + one per-case result recorded directly (no
    // model call needed — this test is about the case CRUD path leaving a
    // recorded run alone, not about running one).
    const [suiteRun] = await pg.handle.db
      .insert(t.evalSuiteRuns)
      .values({
        workspaceId,
        agentId: agent.id,
        agentVersion: 1,
        status: 'completed',
        startedAt: new Date(),
        completedAt: new Date(),
        casesTotal: 1,
        casesCompleted: 1,
        casesPassed: 1,
        casesFailedToComplete: 0,
        recall: 1,
        precision: 1,
        citationAccuracy: 1,
        costUsd: 0.01,
      })
      .returning();
    await pg.handle.db.insert(t.evalRuns).values({
      caseId: created.id,
      suiteRunId: suiteRun!.id,
      actualOutput: [{ file: 'src/config.ts', start_line: 12, end_line: 12, grounded: true }],
      pass: true,
      costUsd: 0.01,
    });

    // Edit the case's name — the ONLY mutable field (AC-45). A stray
    // `expectations` key is silently stripped by the contract, not honoured.
    const editRes = await app.inject({
      method: 'PUT',
      url: `/eval-cases/${created.id}`,
      payload: { name: 'Renamed case' },
    });
    expect(editRes.statusCode).toBe(200);
    const edited = editRes.json();
    expect(edited.name).toBe('Renamed case');
    // Everything else the finding-CRUD path could touch stayed put.
    expect(edited.fragment).toBe(created.fragment);
    expect(edited.file).toBe(created.file);
    expect(edited.start_line).toBe(created.start_line);
    expect(edited.end_line).toBe(created.end_line);
    expect(edited.severity).toBe(created.severity);
    expect(edited.category).toBe(created.category);
    expect(edited.expectations).toEqual(created.expectations);

    // …then soft-delete it.
    const deleteRes = await app.inject({ method: 'DELETE', url: `/eval-cases/${created.id}` });
    expect(deleteRes.statusCode).toBe(200);
    expect(deleteRes.json()).toEqual({ ok: true });

    // The completed run's metrics and its per-case row are untouched.
    const runDetail = await app
      .inject({ method: 'GET', url: `/eval-runs/${suiteRun!.id}` })
      .then((r) => r.json());
    expect(runDetail.recall).toBe(1);
    expect(runDetail.precision).toBe(1);
    expect(runDetail.citation_accuracy).toBe(1);
    expect(runDetail.cost_usd).toBe(0.01);
    expect(runDetail.results).toHaveLength(1);
    expect(runDetail.results[0].passed).toBe(true);
    expect(runDetail.results[0].cost_usd).toBe(0.01);

    // No `eval_cases` row was actually removed — soft delete only.
    const [rawRow] = await pg.handle.db.select().from(t.evalCases).where(eq(t.evalCases.id, created.id));
    expect(rawRow).toBeDefined();
    expect(rawRow!.deletedAt).not.toBeNull();
    await app.close();
  });
});
