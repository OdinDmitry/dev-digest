/**
 * modules/_shared/zones.ts — pure file:line-range helpers shared across
 * modules (eval scoring, multi-agent conflict clustering). Zero runtime
 * imports (`onion-architecture` ring 2, pure).
 */

export interface Zone {
  file: string;
  start: number;
  end: number;
}

/**
 * Repository-relative, forward-slash path, with any single leading diff-side
 * prefix (`a/` or `b/`) stripped. Comparison stays case-sensitive to agree
 * with the citation-grounding gate.
 */
export function normalizeZonePath(path: string): string {
  const posix = path.replace(/\\/g, '/');
  if (posix.startsWith('a/') || posix.startsWith('b/')) return posix.slice(2);
  return posix;
}

/** Two zones match when they name the same file and their closed line ranges
 *  overlap in at least one line. Not used for pass/fail (AC-12). */
export function zonesOverlap(a: Zone, b: Zone): boolean {
  if (normalizeZonePath(a.file) !== normalizeZonePath(b.file)) return false;
  const aLo = Math.min(a.start, a.end);
  const aHi = Math.max(a.start, a.end);
  const bLo = Math.min(b.start, b.end);
  const bHi = Math.max(b.start, b.end);
  return aLo <= bHi && bLo <= aHi;
}
