import { z } from 'zod';

/**
 * Narrow, tolerant Zod parsers for the DevDigest API's wire payloads — this
 * package's anti-corruption layer (Development Plan §2: `mcp/` does NOT
 * vendor `@devdigest/shared`). Each schema covers only the fields §5-§10
 * project; unknown keys are ignored (zod's default `strip`, not `.strict()`,
 * §2's decision, deliberate); every field the projection does not strictly
 * require is `.nullish()`. `test/http.test.ts`'s contract-drift fixtures
 * (literals copied from the real payloads) must keep parsing against these.
 *
 * Ring 0 — imports nothing but `zod`.
 */

/** Mirrors `Repo` (`server/src/vendor/shared/contracts/platform.ts:140`) —
 * `GET /repos` rows. Only the two fields `resolve.ts` needs to address a repo. */
export const WireRepo = z.object({
  id: z.string(),
  full_name: z.string(),
});
export type WireRepo = z.infer<typeof WireRepo>;

/** Mirrors `PrMeta` (`server/src/vendor/shared/contracts/platform.ts:157`) —
 * `GET /repos/:id/pulls` rows. `id` is nullish per the contract (a row can
 * lack a synced id); `resolve.ts` skips those rows (§4). Never parse
 * `PrDetail` here — `GET /pulls/:id` must never be called (constraint 10). */
export const WirePr = z.object({
  id: z.string().nullish(),
  number: z.number().int(),
  title: z.string(),
});
export type WirePr = z.infer<typeof WirePr>;

/** Mirrors `Agent` (`server/src/vendor/shared/contracts/knowledge.ts:285`) —
 * `GET /agents` rows. Deliberately excludes `system_prompt`/`output_schema`/
 * `version`/`strategy`/`ci_fail_on`/`repo_intel` — they are never parsed, so
 * they can never leak into a projection or a log line (§5). */
export const WireAgent = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().nullish(),
  provider: z.string(),
  model: z.string(),
  enabled: z.boolean(),
});
export type WireAgent = z.infer<typeof WireAgent>;

/** Mirrors the `{ pr_id, runs: [{ run_id, agent_id, agent_name }] }` shape of
 * `POST /pulls/:id/review`'s response (`server/src/modules/reviews/service.ts:108`,
 * `routes.ts:43`). The response's `reviews` field is always `[]` at this
 * point (the review is written asynchronously) and is not parsed here. */
export const WireRunStart = z.object({
  pr_id: z.string(),
  runs: z.array(
    z.object({
      run_id: z.string(),
      agent_id: z.string(),
      agent_name: z.string().nullish(),
    }),
  ),
});
export type WireRunStart = z.infer<typeof WireRunStart>;

/** Mirrors `RunSummary` (`server/src/vendor/shared/contracts/trace.ts:98`) —
 * `GET /pulls/:id/runs` rows. `status` is a free string server-side; this
 * package only branches on the `running`/`done`/`failed`/`cancelled` values
 * §6 documents. */
export const WireRun = z.object({
  run_id: z.string(),
  agent_id: z.string().nullish(),
  agent_name: z.string().nullish(),
  status: z.string().nullish(),
  error: z.string().nullish(),
});
export type WireRun = z.infer<typeof WireRun>;

/** The wire vocabulary is uppercase (`Severity` in
 * `server/src/vendor/shared/contracts/findings.ts:11`); `project.ts`'s
 * `normalizeSeverity` maps it to the lowercase MCP vocabulary and back. */
export const WireSeverity = z.enum(['CRITICAL', 'WARNING', 'SUGGESTION']);
export type WireSeverity = z.infer<typeof WireSeverity>;

/** Mirrors `ReviewDtoFinding` (`server/src/modules/reviews/helpers.ts:12`,
 * which extends the shared `Finding` contract). `id`/`confidence`/`kind`/
 * `trifecta_components`/`evidence`/`review_id`/`accepted_at` are dropped —
 * never useful to a caller without accept/dismiss, which is out of scope
 * (§10). `evidence` is always `null` in this DTO regardless (`findingRowToDto`,
 * `reviews/helpers.ts:48`). */
export const WireFinding = z.object({
  severity: WireSeverity,
  category: z.string(),
  title: z.string(),
  file: z.string(),
  start_line: z.number().int(),
  end_line: z.number().int(),
  rationale: z.string().nullish(),
  suggestion: z.string().nullish(),
  dismissed_at: z.string().nullish(),
});
export type WireFinding = z.infer<typeof WireFinding>;

/** Mirrors `ReviewDto` (`server/src/modules/reviews/helpers.ts:18`) — a
 * **server-internal module type, not a `@devdigest/shared` contract** (§2's
 * justification #1 for not vendoring). `pr_id`/`model`/`grounding` are
 * dropped from the OUTPUT (§10), but `id` and `agent_id` are kept on the
 * wire type for two reasons the output itself never needs: (a) §7 requires
 * filtering by `agent_name` (case-insensitive) with a fallback to `agent_id`
 * equality against the resolved agent uuid — the reliable key; (b) picking
 * "the agent's own most recent review" sorts by `created_at` DESC with `id`
 * DESC as the tiebreaker (constraint 12). `kind` stays a free string (not
 * the `'summary' | 'review'` union) so an unrecognised future kind fails
 * open (filtered out by `=== 'review'`) rather than throwing at the parse
 * boundary. */
export const WireReview = z.object({
  id: z.string(),
  run_id: z.string().nullish(),
  agent_id: z.string().nullish(),
  agent_name: z.string().nullish(),
  kind: z.string(),
  verdict: z.string().nullish(),
  summary: z.string().nullish(),
  score: z.number().nullish(),
  created_at: z.string(),
  findings: z.array(WireFinding),
});
export type WireReview = z.infer<typeof WireReview>;

/** Mirrors `ConventionCandidate`
 * (`server/src/vendor/shared/contracts/knowledge.ts:209`) — `GET
 * /repos/:id/conventions` rows. The evidence shape is **flat**
 * (`evidence_path`/`evidence_start_line`/`evidence_end_line`), not the nested
 * `evidence { file, start_line, end_line, snippet }` the brief described —
 * see the plan's §8 "repo-fact correction". `evidence_snippet` is dropped
 * (largest field, and the caller can open the cited lines itself). `id` is
 * kept ONLY as the constraint-12 sort tiebreaker — it never appears in the
 * projected `ConventionOut` output (§8's "Dropped" list). */
export const WireConvention = z.object({
  id: z.string(),
  rule: z.string(),
  category: z.string().nullish(),
  status: z.enum(['pending', 'accepted', 'rejected']),
  confidence: z.number().nullish(),
  evidence_path: z.string().nullish(),
  evidence_start_line: z.number().int().nullish(),
  evidence_end_line: z.number().int().nullish(),
});
export type WireConvention = z.infer<typeof WireConvention>;

/** Mirrors `PrBlastSymbol` (`server/src/vendor/shared/contracts/blast.ts:21`)
 * — an entry in `PrBlastRadius.changed_symbols`. `kind` is dropped from the
 * projection (§10's `{ symbol, location, callers }` never surfaces it), so
 * it stays `.nullish()`; `file`/`name` are required — they build `location`
 * and the `via_symbol` match key. `line` (1-based declaration line, `null`
 * when the indexer recorded none) feeds `symbolLocation()`'s `file:line`
 * projection — house style: `.nullish()` since the projection tolerates its
 * absence (falls back to the bare file path). */
export const WireBlastSymbol = z.object({
  file: z.string(),
  name: z.string(),
  kind: z.string().nullish(),
  line: z.number().int().nullish(),
});
export type WireBlastSymbol = z.infer<typeof WireBlastSymbol>;

/** Mirrors `PrBlastCaller` (`server/src/vendor/shared/contracts/blast.ts:28`)
 * — an entry in `PrBlastRadius.callers`. `rank` is dropped from the
 * projection (the server already returns callers in its own total order,
 * §5 of the Development Plan) so it stays `.nullish()`. */
export const WireBlastCaller = z.object({
  file: z.string(),
  symbol: z.string(),
  via_symbol: z.string(),
  line: z.number().int(),
  rank: z.number().nullish(),
});
export type WireBlastCaller = z.infer<typeof WireBlastCaller>;

/** Mirrors `PrBlastEndpoint`
 * (`server/src/vendor/shared/contracts/blast.ts:37`) — an entry in
 * `PrBlastRadius.impacted_endpoints`. */
export const WireBlastEndpoint = z.object({
  endpoint: z.string(),
  file: z.string(),
  hops: z.number().int(),
});
export type WireBlastEndpoint = z.infer<typeof WireBlastEndpoint>;

/** Mirrors `PrBlastRadius`
 * (`server/src/vendor/shared/contracts/blast.ts:44`) — `GET
 * /pulls/:id/blast`'s response. `pr_id`/`repo_id` are dropped entirely (the
 * tool already has both from `resolveRepo`/`resolvePr` — never re-derived
 * from the wire payload, constraint 12 of `specs/0004-local-mcp-server.md`).
 * `reason` is `.nullish()` per the Development Plan §10 (it is `null` on the
 * wire when `state === 'ok'`, and a future server build could drop the key
 * entirely without breaking this parser). */
export const WireBlast = z.object({
  state: z.enum(['ok', 'partial', 'degraded']),
  reason: z.string().nullish(),
  changed_files: z.array(z.string()),
  changed_symbols: z.array(WireBlastSymbol),
  callers: z.array(WireBlastCaller),
  callers_total: z.number().int(),
  callers_truncated: z.boolean(),
  impacted_endpoints: z.array(WireBlastEndpoint),
  endpoints_truncated: z.boolean(),
});
export type WireBlast = z.infer<typeof WireBlast>;
