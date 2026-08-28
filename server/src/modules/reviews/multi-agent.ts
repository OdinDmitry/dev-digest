import type { AgentColumn, Conflict, ConflictTake } from '@devdigest/shared';
import type { FindingRecord, Severity } from '@devdigest/shared';
import { normalizeZonePath, zonesOverlap, type Zone } from '../_shared/zones.js';

/**
 * modules/reviews/multi-agent.ts — derives the multi-agent disagreement block
 * from a group's columns (`onion-architecture` ring 2, pure). Zero runtime
 * imports beyond `../_shared/zones.js`; everything else crossing this file's
 * boundary is a type only.
 */

/** CRITICAL > WARNING > SUGGESTION. Lower rank = more severe. */
const SEVERITY_RANK: Record<Severity, number> = {
  CRITICAL: 0,
  WARNING: 1,
  SUGGESTION: 2,
};

interface ParticipantFinding {
  agentId: string;
  /** Index into `participants`, used to order takes by given column order. */
  participantIndex: number;
  /** Index into the owning column's own `findings` array — the agent's own
   *  produced order, used to break severity ties (T6c). */
  ownOrder: number;
  finding: FindingRecord;
}

function findingZone(f: FindingRecord): Zone {
  return { file: f.file, start: f.start_line, end: f.end_line };
}

/**
 * Sort by (normalizeZonePath(file), start_line, end_line, id) and greedily
 * extend the open cluster while the next finding overlaps its accumulated
 * range — so 1-5 / 5-10 / 10-15 in one file merge into a single location,
 * while non-overlapping ranges start a new one.
 */
function clusterFindings(all: ParticipantFinding[]): ParticipantFinding[][] {
  const sorted = [...all].sort((a, b) => {
    const fa = normalizeZonePath(a.finding.file);
    const fb = normalizeZonePath(b.finding.file);
    if (fa !== fb) return fa < fb ? -1 : 1;
    if (a.finding.start_line !== b.finding.start_line) {
      return a.finding.start_line - b.finding.start_line;
    }
    if (a.finding.end_line !== b.finding.end_line) {
      return a.finding.end_line - b.finding.end_line;
    }
    return a.finding.id < b.finding.id ? -1 : a.finding.id > b.finding.id ? 1 : 0;
  });

  const clusters: ParticipantFinding[][] = [];
  let current: ParticipantFinding[] = [];
  let currentZone: Zone | null = null;

  for (const pf of sorted) {
    const zone = findingZone(pf.finding);
    if (currentZone && zonesOverlap(zone, currentZone)) {
      current.push(pf);
      currentZone = {
        file: currentZone.file,
        start: currentZone.start,
        end: Math.max(currentZone.end, zone.end),
      };
    } else {
      if (current.length > 0) clusters.push(current);
      current = [pf];
      currentZone = zone;
    }
  }
  if (current.length > 0) clusters.push(current);
  return clusters;
}

/** The most severe finding in a participant's cluster subset, ties broken by
 *  the agent's own produced order. */
function mostSevere(findings: ParticipantFinding[]): ParticipantFinding {
  return findings.reduce((best, next) => {
    const bestRank = SEVERITY_RANK[best.finding.severity];
    const nextRank = SEVERITY_RANK[next.finding.severity];
    if (nextRank < bestRank) return next;
    if (nextRank === bestRank && next.ownOrder < best.ownOrder) return next;
    return best;
  });
}

function buildTakes(
  participants: AgentColumn[],
  cluster: ParticipantFinding[],
): ConflictTake[] {
  return participants.map((participant, participantIndex) => {
    const own = cluster.filter((pf) => pf.participantIndex === participantIndex);
    if (own.length === 0) {
      return {
        agent_id: participant.agent_id,
        agent_name: participant.agent_name,
        verdict: 'ignored',
        note: null,
      };
    }
    const winner = mostSevere(own);
    return {
      agent_id: participant.agent_id,
      agent_name: participant.agent_name,
      verdict: winner.finding.severity,
      note: winner.finding.title,
    };
  });
}

/**
 * A row is a conflict when at least one participant flagged the location
 * while another produced nothing there, or when two participants flagged it
 * with different severities (AC-20).
 */
function isConflict(takes: ConflictTake[]): boolean {
  const flagged = takes.filter((t) => t.verdict !== 'ignored');
  const ignored = takes.filter((t) => t.verdict === 'ignored');
  if (flagged.length > 0 && ignored.length > 0) return true;
  const severities = new Set(flagged.map((t) => t.verdict));
  return severities.size >= 2;
}

/**
 * Derive the disagreement block from a multi-agent group's columns.
 * Non-`done` columns are excluded from every row and from conflict
 * determination (AC-21).
 */
export function buildConflicts(columns: AgentColumn[]): Conflict[] {
  const participants = columns.filter((c) => c.status === 'done');

  const all: ParticipantFinding[] = [];
  participants.forEach((participant, participantIndex) => {
    participant.findings.forEach((finding, ownOrder) => {
      all.push({ agentId: participant.agent_id, participantIndex, ownOrder, finding });
    });
  });

  const clusters = clusterFindings(all);

  const rows: Conflict[] = clusters.map((cluster) => {
    const file = cluster[0]!.finding.file;
    const start_line = Math.min(...cluster.map((pf) => pf.finding.start_line));
    const end_line = Math.max(...cluster.map((pf) => pf.finding.end_line));
    const takes = buildTakes(participants, cluster);
    return {
      file,
      start_line,
      end_line,
      is_conflict: isConflict(takes),
      takes,
    };
  });

  rows.sort((a, b) => {
    const fa = normalizeZonePath(a.file);
    const fb = normalizeZonePath(b.file);
    if (fa !== fb) return fa < fb ? -1 : 1;
    return a.start_line - b.start_line;
  });

  return rows;
}
