import type { CiRun } from "@devdigest/shared";

/** `iso` → the browser's locale format, or the raw string when unparsable. */
export function formatWhen(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString();
}

/** This agent's runs recorded against ONE installation (T11: "a row-level
 *  line for an installation with no runs yet"). `CiRun.ci_installation_id`
 *  is nullable (a run can outlive its installation) — those never match any
 *  specific installation here, by design. */
export function runsForInstallation(runs: CiRun[], installationId: string): CiRun[] {
  return runs.filter((r) => r.ci_installation_id === installationId);
}
