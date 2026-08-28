import type { CiFailOn, CiInstallation, CiTarget } from '@devdigest/shared';
import type { CiInstallationRow } from '../../db/rows.js';

/**
 * CI module pure helpers (ring 2, no HTTP, no SQL): slug generation for the
 * manifest/skill file names, and the installation row → DTO mapper.
 */

/** Lowercase, dash-separated slug (used for `.devdigest/{agents,skills}` file names). */
export function slugify(name: string): string {
  const base = name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return base || 'agent';
}

/**
 * Slugify every name, then deterministically dedupe collisions with a
 * "-2", "-3", ... suffix — in INPUT ORDER, not sorted, so the same agent
 * list always yields the same file names regardless of iteration order.
 */
export function uniqueSlugs(names: string[]): string[] {
  const seen = new Map<string, number>();
  return names.map((name) => {
    const base = slugify(name);
    const count = seen.get(base) ?? 0;
    seen.set(base, count + 1);
    return count === 0 ? base : `${base}-${count + 1}`;
  });
}

/**
 * Map a `ci_installations` row to its API DTO. `current` is true only when
 * the row's recorded `workflow_version` matches the CURRENT generator
 * version (`WORKFLOW_VERSION`) — a `null` version (never installed with a
 * marker, or reset) is therefore never current (AC-9).
 */
export function installationToDto(
  row: CiInstallationRow,
  agentName: string | null,
  currentVersion: string,
): CiInstallation {
  return {
    id: row.id,
    agent_id: row.agentId,
    agent_name: agentName,
    repo: row.repo,
    target_type: row.targetType as CiTarget,
    installed_at: row.installedAt.toISOString(),
    updated_at: row.updatedAt.toISOString(),
    workflow_version: row.workflowVersion,
    pr_url: row.prUrl,
    ci_fail_on: row.ciFailOn as CiFailOn,
    current: row.workflowVersion === currentVersion,
  };
}
