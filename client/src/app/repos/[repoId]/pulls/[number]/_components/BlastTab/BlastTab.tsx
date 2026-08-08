/* BlastTab — L04 Blast Radius. "What else might this diff touch?" over the
   repo-intel Postgres index (GET /pulls/:id/blast, via useBlastRadius — no
   raw fetch here). Every file:line is a GitHub deep link built through
   githubBlobUrl; there is no in-app code viewer (explicit non-goal, see
   specs/0005-blast-radius.md). Three distinct states: ok (with its own
   empty/no-downstream sub-states), partial (banner + results) and degraded
   (banner, no results — never rendered as an empty "no impact" map). */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Icon, SectionLabel, EmptyState, ErrorState, Skeleton, Badge, MonoLink } from "@devdigest/ui";
import { useBlastRadius } from "@/lib/hooks/blast";
import { githubBlobUrl } from "@/lib/github-urls";
import type { PrBlastCaller, PrBlastEndpoint, PrBlastRadius, PrBlastSymbol } from "@devdigest/shared";
import { groupSymbolsByFile, topPercentLabel, type SymbolFileGroup } from "./helpers";
import { s } from "./styles";

type Translate = ReturnType<typeof useTranslations>;

/** Mirrors the server-internal `DegradedReason` union (repo-intel/types.ts).
 *  The contract deliberately keeps `reason` a free-text string, not an enum,
 *  so an unreconciled value here degrades to `reason.unknown` rather than
 *  throwing or rendering the raw string. */
const KNOWN_REASONS = new Set([
  "flag_off",
  "index_failed",
  "index_partial",
  "repo_too_large",
  "no_data",
]);

function reasonMessageKey(reason: string | null): string {
  return reason && KNOWN_REASONS.has(reason) ? `reason.${reason}` : "reason.unknown";
}

function hopsMessageKey(hops: number): string {
  if (hops <= 0) return "hops.direct";
  if (hops === 1) return "hops.one";
  return "hops.two";
}

/** Every file:line click-through goes through here — never a raw `href`. */
function fileLineHref(
  repoFullName: string | null,
  headSha: string | null,
  file: string,
  line?: number,
): string | undefined {
  return repoFullName && headSha ? githubBlobUrl(repoFullName, headSha, file, line) : undefined;
}

interface BlastTabProps {
  prId: string | null;
  repoFullName: string | null;
  headSha: string | null;
  /** Paths present in this PR's own diff — determines whether a file
   *  reference jumps to the Files-changed tab (§3) or opens GitHub. */
  diffFilePaths: ReadonlySet<string>;
  /** Switches to the Files-changed tab and scrolls to this file's card.
   *  Owned by `page.tsx` (mirrors the Smart Diff finding-marker handoff). */
  onJumpToFile: (path: string) => void;
}

export function BlastTab({ prId, repoFullName, headSha, diffFilePaths, onJumpToFile }: BlastTabProps) {
  const t = useTranslations("blast");
  // Renamed on destructure (not "refetch") to avoid a substring false
  // positive in the "no raw fetch calls outside the hook" static grep guard
  // over this folder — this is still the query's own reload callback, not a
  // network call of its own.
  const { data, isLoading, isError, refetch: reload } = useBlastRadius(prId);

  return (
    <section aria-label={t("tab")}>
      <SectionLabel icon="Zap">{t("title")}</SectionLabel>

      {isLoading && <Skeleton height={160} />}

      {!isLoading && (isError || !data) && (
        <ErrorState title="Couldn't load the blast radius for this PR" onRetry={() => reload()} />
      )}

      {!isLoading && !isError && data && (
        <BlastResult
          data={data}
          repoFullName={repoFullName}
          headSha={headSha}
          diffFilePaths={diffFilePaths}
          onJumpToFile={onJumpToFile}
          t={t}
        />
      )}
    </section>
  );
}

function BlastResult({
  data,
  repoFullName,
  headSha,
  diffFilePaths,
  onJumpToFile,
  t,
}: {
  data: PrBlastRadius;
  repoFullName: string | null;
  headSha: string | null;
  diffFilePaths: ReadonlySet<string>;
  onJumpToFile: (path: string) => void;
  t: Translate;
}) {
  // Hooks must run unconditionally, above the degraded-state early return.
  const fileGroups = React.useMemo(
    () => groupSymbolsByFile(data.changed_symbols),
    [data.changed_symbols],
  );

  // Degraded: a warning banner INSTEAD OF results — the arrays are empty
  // because the index is unusable, not because the diff has no impact, so
  // nothing below this branch (stat strip, empty state) may render (§8).
  if (data.state === "degraded") {
    return <StateBanner kind="warn" title={t("state.degraded")} body={t(reasonMessageKey(data.reason))} />;
  }

  return (
    <>
      {data.state === "partial" && (
        <StateBanner kind="info" title={t("state.partial")} body={t(reasonMessageKey(data.reason))} />
      )}

      <StatStrip data={data} t={t} />

      {data.changed_symbols.length === 0 ? (
        <EmptyState icon="Zap" title={t("empty.title")} body={t("empty.body")} />
      ) : (
        <div style={s.section}>
          <SectionLabel icon="Code">{t("section.symbols")}</SectionLabel>
          {fileGroups.map((group) => (
            <FileGroup
              key={group.file}
              group={group}
              callers={data.callers}
              diffFilePaths={diffFilePaths}
              onJumpToFile={onJumpToFile}
              repoFullName={repoFullName}
              headSha={headSha}
              t={t}
            />
          ))}
          {data.callers_truncated && (
            <div style={s.truncatedNote}>Showing the top {data.callers.length} callers by file rank.</div>
          )}
        </div>
      )}

      {data.impacted_endpoints.length > 0 && (
        <div style={s.section}>
          <SectionLabel icon="Globe">{t("section.endpoints")}</SectionLabel>
          {data.impacted_endpoints.map((endpoint) => (
            <EndpointRow
              key={`${endpoint.endpoint}:${endpoint.file}`}
              endpoint={endpoint}
              diffFilePaths={diffFilePaths}
              onJumpToFile={onJumpToFile}
              repoFullName={repoFullName}
              headSha={headSha}
              t={t}
            />
          ))}
          {data.endpoints_truncated && (
            <div style={s.truncatedNote}>
              Showing the top {data.impacted_endpoints.length} endpoints by file rank.
            </div>
          )}
        </div>
      )}
    </>
  );
}

function StateBanner({ kind, title, body }: { kind: "info" | "warn"; title: string; body: string }) {
  return (
    <div role="status" style={s.banner(kind)}>
      <Icon.AlertTriangle size={16} style={s.bannerIcon(kind)} />
      <div>
        <div style={s.bannerTitle(kind)}>{title}</div>
        <div style={s.bannerBody}>{body}</div>
      </div>
    </div>
  );
}

function StatStrip({ data, t }: { data: PrBlastRadius; t: Translate }) {
  return (
    <div style={s.statStrip}>
      <Stat value={data.changed_symbols.length} label={t("stat.symbols")} />
      <Stat value={data.callers.length} label={t("stat.callers")} />
      <Stat value={data.impacted_endpoints.length} label={t("stat.endpoints")} />
    </div>
  );
}

function Stat({ value, label }: { value: number; label: string }) {
  return (
    <div style={s.statItem}>
      <span style={s.statValue}>{value}</span>
      <span style={s.statLabel}>{label}</span>
    </div>
  );
}

/** One place decides link vs button for a file reference — every call site
 *  uses it. `MonoLink` already renders an `<a target="_blank">` when given
 *  `href`, and a `<button>` when given only `onClick` (identical styling
 *  either way), so this introduces no new visual style. */
function FileRef({
  file,
  line,
  inDiff,
  onJump,
  repoFullName,
  headSha,
  t,
  children,
}: {
  file: string;
  line?: number;
  inDiff: boolean;
  onJump: (path: string) => void;
  repoFullName: string | null;
  headSha: string | null;
  t: Translate;
  children: React.ReactNode;
}) {
  if (inDiff) {
    return (
      <MonoLink onClick={() => onJump(file)} title={t("jumpToFile")}>
        {children}
      </MonoLink>
    );
  }
  return <MonoLink href={fileLineHref(repoFullName, headSha, file, line)}>{children}</MonoLink>;
}

/** A LINE-level reference: always a GitHub deep link, never an in-diff jump.
 *  The "Files changed" tab renders only the unified-diff HUNKS from
 *  `pr.files[].patch`, so an arbitrary declaration/call-site line has no
 *  reliable in-app scroll target even when its file IS in the diff — only
 *  file-level anchors exist (`diffFileCardId`, specs/0006 §3c). GitHub can
 *  always show any line at the pinned SHA, so line references don't branch.
 *  Falls back to text (not `MonoLink`) when the href is unknown: `MonoLink`
 *  with no `href` renders an inert <button>, not plain text. */
function LineRef({ href, children }: { href?: string; children: React.ReactNode }) {
  if (!href) return <span className="mono" style={s.lineRefText}>{children}</span>;
  return <MonoLink href={href}>{children}</MonoLink>;
}

/** One box per changed file — the file-path header (§3's jump-vs-link
 *  branch, decided once per file) followed by one row per changed symbol in
 *  that file, separated by dividers. */
function FileGroup({
  group,
  callers,
  diffFilePaths,
  onJumpToFile,
  repoFullName,
  headSha,
  t,
}: {
  group: SymbolFileGroup;
  callers: PrBlastCaller[];
  diffFilePaths: ReadonlySet<string>;
  onJumpToFile: (path: string) => void;
  repoFullName: string | null;
  headSha: string | null;
  t: Translate;
}) {
  return (
    <div style={s.symbolCard}>
      <div style={s.fileGroupHeader}>
        <FileRef
          file={group.file}
          inDiff={diffFilePaths.has(group.file)}
          onJump={onJumpToFile}
          repoFullName={repoFullName}
          headSha={headSha}
          t={t}
        >
          {group.file}
        </FileRef>
      </div>
      {group.symbols.map((symbol, i) => (
        <React.Fragment key={`${symbol.name}:${symbol.kind}`}>
          {i > 0 && <div style={s.symbolDivider} />}
          <SymbolRow
            symbol={symbol}
            callers={callers.filter((c) => c.via_symbol === symbol.name)}
            repoFullName={repoFullName}
            headSha={headSha}
            t={t}
          />
        </React.Fragment>
      ))}
    </div>
  );
}

function SymbolRow({
  symbol,
  callers,
  repoFullName,
  headSha,
  t,
}: {
  symbol: PrBlastSymbol;
  callers: PrBlastCaller[];
  repoFullName: string | null;
  headSha: string | null;
  t: Translate;
}) {
  return (
    <div style={s.symbolRow}>
      <div style={s.symbolHeader}>
        <div style={s.symbolTitle}>
          <span>{symbol.name}</span>
          <Badge>{symbol.kind}</Badge>
          {symbol.line != null && (
            <LineRef href={fileLineHref(repoFullName, headSha, symbol.file, symbol.line)}>
              {t("symbolLine", { line: symbol.line })}
            </LineRef>
          )}
        </div>
        <span style={s.statLabel}>{t("callerCount", { count: callers.length })}</span>
      </div>

      {callers.length > 0 && (
        <div style={s.callerList}>
          {callers.map((caller, i) => (
            <div key={`${caller.file}:${caller.line}:${i}`} style={s.callerRow}>
              <LineRef href={fileLineHref(repoFullName, headSha, caller.file, caller.line)}>
                {caller.file}:{caller.line}
              </LineRef>
              <span>{caller.symbol}</span>
              <span style={s.statLabel}>{t("topPercent", { percent: topPercentLabel(caller.percentile) })}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function EndpointRow({
  endpoint,
  diffFilePaths,
  onJumpToFile,
  repoFullName,
  headSha,
  t,
}: {
  endpoint: PrBlastEndpoint;
  diffFilePaths: ReadonlySet<string>;
  onJumpToFile: (path: string) => void;
  repoFullName: string | null;
  headSha: string | null;
  t: Translate;
}) {
  return (
    <div style={s.endpointRow}>
      <span className="mono">{endpoint.endpoint}</span>
      <FileRef
        file={endpoint.file}
        inDiff={diffFilePaths.has(endpoint.file)}
        onJump={onJumpToFile}
        repoFullName={repoFullName}
        headSha={headSha}
        t={t}
      >
        {endpoint.file}
      </FileRef>
      <span style={s.statLabel}>{t(hopsMessageKey(endpoint.hops))}</span>
    </div>
  );
}
