import type { EvalInvokedSkill } from "@devdigest/shared";
import type { DisplayValue } from "../helpers";

/** Later minus earlier — `null` when either side is absent (frozen signature,
 *  Shared contract § D). */
export function metricDelta(a: number | null, b: number | null): number | null {
  if (a == null || b == null) return null;
  return b - a;
}

/** True when the two runs did not cover the same SET of eval cases (order
 *  doesn't matter — a run's `case_ids` is a snapshot, not a sequence). */
export function caseSetsDiffer(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return true;
  const setA = new Set(a);
  return b.some((id) => !setA.has(id));
}

/** True when the two runs invoked a different SET of skill ids, or the same
 *  id at a different version (AC-39). Order is not compared. */
export function invokedSkillsDiffer(a: EvalInvokedSkill[], b: EvalInvokedSkill[]): boolean {
  if (a.length !== b.length) return true;
  const mapA = new Map(a.map((sk) => [sk.skill_id, sk.skill_version]));
  return b.some((sk) => mapA.get(sk.skill_id) !== sk.skill_version);
}

export interface SkillVersionDiff {
  skillId: string;
  name: string;
  earlierVersion: number | null;
  laterVersion: number | null;
}

/** The skills that differ between two invoked-skill snapshots — by presence
 *  or by version — for naming in the differing-skills statement (AC-39).
 *  `name` prefers the later run's snapshot (a rename between runs is
 *  invisible to this comparison by design — SPEC-03 Edge cases). */
export function differingSkills(a: EvalInvokedSkill[], b: EvalInvokedSkill[]): SkillVersionDiff[] {
  const mapA = new Map(a.map((sk) => [sk.skill_id, sk]));
  const mapB = new Map(b.map((sk) => [sk.skill_id, sk]));
  const ids = new Set([...mapA.keys(), ...mapB.keys()]);
  const diffs: SkillVersionDiff[] = [];
  for (const id of ids) {
    const sa = mapA.get(id);
    const sb = mapB.get(id);
    if (sa?.skill_version === sb?.skill_version && !!sa === !!sb) continue;
    diffs.push({
      skillId: id,
      name: sb?.name ?? sa?.name ?? id,
      earlierVersion: sa?.skill_version ?? null,
      laterVersion: sb?.skill_version ?? null,
    });
  }
  return diffs;
}

/** A recall/precision/citation-accuracy delta as "+4pt"/"-2pt", or an em
 *  dash when either side was absent. */
export function formatPercentDelta(delta: number | null): DisplayValue {
  if (delta == null) return { text: "—", absent: true };
  const pts = Math.round(delta * 100);
  const sign = pts > 0 ? "+" : pts < 0 ? "" : "±";
  return { text: `${sign}${pts}pt`, absent: false };
}

/** A cost delta as "+$0.02"/"-$0.01", or an em dash when either side was
 *  absent (AC-37 — absent is never rendered as a $0.00 delta). */
export function formatCostDelta(delta: number | null): DisplayValue {
  if (delta == null) return { text: "—", absent: true };
  const sign = delta > 0 ? "+" : delta < 0 ? "-" : "±";
  const abs = Math.abs(delta);
  const digits = abs >= 1 ? abs.toFixed(2) : String(Number(abs.toPrecision(2)));
  return { text: `${sign}$${digits}`, absent: false };
}
