import type { EvalCaseRecord, EvalReturnedFinding, EvalSuiteRun, Finding, LLMProvider, Provider } from '@devdigest/shared';
import { reviewPullRequest, DEFAULT_REVIEW_MAX_RETRIES } from '@devdigest/reviewer-core';
import { AppError, NotFoundError, ValidationError } from '../../platform/errors.js';
import { parseUnifiedDiff } from '../../adapters/git/diff-parser.js';
import type { AgentsRepository } from '../agents/repository.js';
import type { EvalRepository } from './repository.js';
import { casePassed, countMatchedFindings, scoreSuite, sumCost, type ScoredCase } from './scoring.js';

/**
 * The slice of an agent's config `EvalRunner` actually reads to replay it —
 * a ring-2 file must not hold a database row type (a repository row dies at
 * the repository boundary). Nothing in this module narrows a row to this
 * shape: `AgentsRepository.getConfigById` (ring 3, `modules/agents/`) does
 * that narrowing itself and hands back exactly this shape, so both
 * `service.ts` (for `start()`) and `verifyCase()` below (which resolves its
 * own agent, since its frozen signature takes only `workspaceId`/`caseId`)
 * receive it pre-narrowed. Structurally identical to `AgentConfig` in
 * `modules/agents/helpers.ts` — kept as its own declaration here so this
 * module never has to import from `modules/agents` beyond the repository
 * class it already depends on.
 */
export interface EvalAgentConfig {
  id: string;
  name: string;
  version: number;
  provider: Provider;
  model: string;
  systemPrompt: string;
}

/** What one invocation of the agent over one case produced — shared by both
 *  entry points via `invokeCase()`. */
interface InvokeCaseOutcome {
  completed: boolean;
  findings: EvalReturnedFinding[];
  costUsd: number | null;
  error: string | null;
}

/**
 * EvalRunner — starts and executes an eval suite run.
 *
 * AC-17: this module deliberately invokes `reviewPullRequest` with ONLY the
 * case's own frozen fragment, the agent's own system prompt/model/strategy,
 * and its enabled linked skills' bodies. Every other prompt-time enrichment a
 * real review performs — a callers digest, a repo skeleton, a hot-file rank
 * note, and the agent's attached project-context documents read from the
 * repository's working copy — is unconditionally absent here, regardless of
 * the agent's own repo-intel setting. A skill body is the one deliberate
 * exception: it is authored configuration attached to the agent, not
 * repository content resolved at run time, which is why AC-18 does not
 * conflict with AC-17.
 */
export interface EvalRunnerDeps {
  repo: EvalRepository;
  agents: Pick<AgentsRepository, 'linkedSkills' | 'getConfigById'>;
  llm: (id: Provider) => Promise<LLMProvider>;
}

function isUniqueViolation(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: string }).code === '23505';
}

function toReturnedFinding(f: Finding, grounded: boolean): EvalReturnedFinding {
  return {
    file: f.file,
    start_line: f.start_line,
    end_line: f.end_line,
    grounded,
    severity: f.severity,
    title: f.title,
  };
}

export class EvalRunner {
  constructor(private deps: EvalRunnerDeps) {}

  /**
   * Refuses an empty case set (422) and translates the partial unique
   * index's violation into a 409 (AC-16) — two concurrent starts for the
   * same agent cannot both win. Snapshots `cases_total`, the covering case
   * ids AND the invoked skill set atomically, then fires the background
   * execution WITHOUT awaiting it (mirrors `run-executor.ts:68-70`) so the
   * route can respond 202 immediately.
   *
   * Caller contract: `agent` must already have been resolved through a
   * workspace-scoped read (`AgentsRepository.linkedSkills` is NOT
   * workspace-scoped on its own — see `run-executor.ts:443-445`).
   */
  async start(workspaceId: string, agent: EvalAgentConfig): Promise<EvalSuiteRun> {
    const cases = await this.deps.repo.listCasesForAgent(workspaceId, agent.id);
    if (cases.length === 0) {
      throw new ValidationError('This agent has no eval cases to run');
    }

    const links = await this.deps.agents.linkedSkills(agent.id);
    const enabledLinks = links.filter((l) => l.skill.enabled);

    let suiteRun: EvalSuiteRun;
    try {
      suiteRun = await this.deps.repo.startSuiteRun({
        workspaceId,
        agentId: agent.id,
        agentName: agent.name,
        agentVersion: agent.version,
        caseIds: cases.map((c) => c.id),
        invokedSkills: enabledLinks.map((l) => ({
          skillId: l.skill.id,
          skillVersion: l.skill.version,
          skillName: l.skill.name,
          linkOrder: l.order,
        })),
      });
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new AppError('conflict', 'An eval run is already running for this agent', 409);
      }
      throw err;
    }

    const skillBodies = enabledLinks.map((l) => l.skill.body);
    void this.execute(suiteRun.id, agent, cases, skillBodies);

    return suiteRun;
  }

  /**
   * The one call site both `execute()` (a suite run) and `verifyCase()`
   * (AC-46) use to invoke the agent over a single case — AC-17/AC-18's frozen
   * key list exists exactly once because of this. Never throws: a failed
   * invocation comes back as `completed: false` with `error` set, exactly as
   * the inline try/catch it replaces did.
   */
  private async invokeCase(
    agent: EvalAgentConfig,
    evalCase: Pick<EvalCaseRecord, 'fragment'>,
    skillBodies: string[],
  ): Promise<InvokeCaseOutcome> {
    try {
      const llm = await this.deps.llm(agent.provider);
      // AC-17 — the frozen invocation: exactly these keys, no other.
      const outcome = await reviewPullRequest({
        systemPrompt: agent.systemPrompt,
        model: agent.model,
        llm,
        diff: parseUnifiedDiff(evalCase.fragment),
        strategy: 'single-pass',
        maxRetries: DEFAULT_REVIEW_MAX_RETRIES,
        ...(skillBodies.length > 0 ? { skills: skillBodies } : {}),
      });
      const findings = [
        ...outcome.review.findings.map((f) => toReturnedFinding(f, true)),
        ...outcome.dropped.map((d) => toReturnedFinding(d.finding, false)),
      ];
      return { completed: true, findings, costUsd: outcome.costUsd, error: null };
    } catch (err) {
      return { completed: false, findings: [], costUsd: null, error: (err as Error).message };
    }
  }

  private async execute(
    suiteRunId: string,
    agent: EvalAgentConfig,
    cases: EvalCaseRecord[],
    skillBodies: string[],
  ): Promise<void> {
    try {
      const scored: ScoredCase[] = [];
      const costs: (number | null)[] = [];

      for (const c of cases) {
        const outcome = await this.invokeCase(agent, c, skillBodies);

        const scoredCase: ScoredCase = {
          caseId: c.id,
          expectations: c.expectations,
          findings: outcome.findings,
          completed: outcome.completed,
        };
        const pass = outcome.completed ? casePassed(scoredCase) : null;

        await this.deps.repo.recordCaseResult(suiteRunId, c.id, {
          actualOutput: outcome.completed ? outcome.findings : null,
          pass,
          costUsd: outcome.costUsd,
          error: outcome.error,
        });
        // Bumped after every case, success or failure (AC-15).
        await this.deps.repo.bumpCaseProgress(suiteRunId);
        // A case's most recent result may come from either kind of
        // invocation (SPEC-04 § Contracts, Case result) — a suite run moves
        // this pointer too, alongside its own permanent per-run row.
        await this.deps.repo.writeLatestResult(c.id, {
          completed: outcome.completed,
          passed: pass,
          error: outcome.error,
          findings: outcome.findings,
          matched_count: countMatchedFindings(scoredCase),
          ran_at: new Date().toISOString(),
        });

        scored.push(scoredCase);
        costs.push(outcome.costUsd);
      }

      const metrics = scoreSuite(scored);
      await this.deps.repo.finalizeSuiteRun(suiteRunId, {
        status: 'completed',
        recall: metrics.recall,
        precision: metrics.precision,
        citationAccuracy: metrics.citationAccuracy,
        costUsd: sumCost(costs),
        casesPassed: metrics.casesPassed,
        casesFailedToComplete: metrics.casesFailedToComplete,
      });
    } catch {
      // A failure outside the per-case loop (e.g. the provider itself could
      // not be resolved) must not leave the run stuck 'running' forever.
      await this.deps.repo
        .finalizeSuiteRun(suiteRunId, {
          status: 'failed',
          recall: null,
          precision: null,
          citationAccuracy: null,
          costUsd: null,
          casesPassed: null,
          casesFailedToComplete: cases.length,
        })
        .catch(() => undefined);
    }
  }

  /**
   * AC-46 — a single-case verification: one invocation, scored alone,
   * recorded ONLY on the case (`eval_cases.latest_result`). Calls none of the
   * suite-run lifecycle methods `execute()` above uses — that absence is what
   * makes AC-49/AC-50 structural rather than a promise. No run-in-progress
   * check: AC-16 bars a second RUN; SPEC-04's edge case explicitly permits
   * verifying while a suite run is in progress.
   */
  async verifyCase(workspaceId: string, caseId: string): Promise<EvalCaseRecord> {
    const evalCase = await this.deps.repo.getCase(workspaceId, caseId);
    if (!evalCase) throw new NotFoundError('Eval case not found');

    // Resolve the agent workspace-scoped FIRST — `linkedSkills` is not
    // workspace-scoped on its own.
    const agent = await this.deps.agents.getConfigById(workspaceId, evalCase.agent_id);
    if (!agent) throw new NotFoundError('Agent not found');

    const links = await this.deps.agents.linkedSkills(agent.id);
    const enabledLinks = links.filter((l) => l.skill.enabled);
    const skillBodies = enabledLinks.map((l) => l.skill.body);

    const outcome = await this.invokeCase(agent, evalCase, skillBodies);
    const scoredCase: ScoredCase = {
      caseId: evalCase.id,
      expectations: evalCase.expectations,
      findings: outcome.findings,
      completed: outcome.completed,
    };

    await this.deps.repo.writeLatestResult(evalCase.id, {
      completed: outcome.completed,
      passed: outcome.completed ? casePassed(scoredCase) : null,
      error: outcome.error,
      findings: outcome.findings,
      matched_count: countMatchedFindings(scoredCase),
      ran_at: new Date().toISOString(),
    });

    const updated = await this.deps.repo.getCase(workspaceId, caseId);
    if (!updated) throw new NotFoundError('Eval case not found');
    return updated;
  }
}
