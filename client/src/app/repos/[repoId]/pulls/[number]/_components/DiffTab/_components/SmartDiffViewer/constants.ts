/** Constants for SmartDiffViewer — colocated (frontend-ui-architecture rung
 *  2: a single consumer keeps this local rather than promoting it). */

/**
 * A file whose `additions + deletions` exceeds this many lines gets the
 * large-file highlight in Smart mode (plan §9). Deliberately NOT the
 * PR-level `SIZE_SMALL_MAX`/`SIZE_MEDIUM_MAX` buckets
 * (`app/repos/[repoId]/pulls/constants.ts`) — those bucket a WHOLE PR into
 * S/M/L, a different unit of measure (per-PR, not per-file). Reusing them
 * here would make this highlight almost never fire and would couple two
 * unrelated thresholds — a deliberate rejection, not an oversight.
 */
export const LARGE_FILE_LINES = 150;
