/** Constants for the evals module (error messages shared across the
 *  `service.ts` call sites that raise them). */
export const AGENT_NOT_FOUND_MESSAGE = 'Agent not found';
export const EVAL_CASE_NOT_FOUND_MESSAGE = 'Eval case not found';
export const REPO_NOT_FOUND_MESSAGE = 'Repository not found';
export const FINDING_NOT_FOUND_MESSAGE = 'Finding not found';
export const FINDING_NOT_DECIDED_MESSAGE = 'Finding has not been accepted or dismissed';
export const EVAL_RUN_NOT_FOUND_MESSAGE = 'Eval run not found';
export const EVAL_RUN_ACTIVE_MESSAGE = 'A suite run is already active for this agent';
export const EVAL_NO_CASES_MESSAGE = 'Agent has no eval cases to run';
export const EVAL_CASE_EXISTS_FOR_FINDING_MESSAGE =
  'An eval case already exists for this finding';

/**
 * A `running`/`pending` run older than this is treated as dead (a process
 * that crashed mid-run leaves no other signal) and replaced rather than
 * blocking new runs forever (plan Open questions, "stale active run").
 */
export const STALE_RUN_MS = 30 * 60 * 1000;
