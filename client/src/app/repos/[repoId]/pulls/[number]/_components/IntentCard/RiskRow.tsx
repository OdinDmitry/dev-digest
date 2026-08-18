"use client";

import type { useTranslations } from "next-intl";
import type { BriefFileRef, BriefRisk } from "@devdigest/shared";
import { Icon } from "@devdigest/ui";
import { s } from "./styles";

type Translate = ReturnType<typeof useTranslations>;

/** Severity → CSS colour token. Text (`risks.severity.<level>`) is the
 *  primary channel — colour only reinforces it (AC-21's accessibility NFR:
 *  severity must not be conveyed by colour alone). */
const SEVERITY_COLOR: Record<BriefRisk["severity"], { c: string; bg: string }> = {
  high: { c: "var(--crit)", bg: "var(--crit-bg)" },
  medium: { c: "var(--warn)", bg: "var(--warn-bg)" },
  low: { c: "var(--info)", bg: "var(--info-bg)" },
};

function refLabel(ref: BriefFileRef): string {
  if (ref.start_line == null) return ref.path;
  if (ref.end_line == null || ref.end_line === ref.start_line) return `${ref.path}:${ref.start_line}`;
  return `${ref.path}:${ref.start_line}-${ref.end_line}`;
}

/** One expand/collapse risk row inside IntentCard's RISK AREAS subsection
 *  (mockups 3-5). A real `<button>` so Enter/Space activation and
 *  `aria-expanded` come for free — no manual keydown handling needed. The
 *  explanation is only rendered while `expanded` (never CSS-hidden), per
 *  T28/AC-22. */
export function RiskRow({
  risk,
  expanded,
  onToggle,
  onJumpToFile,
  t,
}: {
  risk: BriefRisk;
  expanded: boolean;
  onToggle: () => void;
  onJumpToFile: (path: string) => void;
  t: Translate;
}) {
  const sev = SEVERITY_COLOR[risk.severity];

  return (
    <div style={s.riskRow}>
      <div style={s.riskHeader}>
        <span style={s.riskSeverity(sev.c, sev.bg)}>{t(`risks.severity.${risk.severity}`)}</span>
        <div style={s.riskMain}>
          <span style={s.riskTitle}>{risk.title}</span>
          <div style={s.riskRefs}>
            {risk.refs.map((ref, i) => (
              <button
                key={`${ref.path}:${ref.start_line ?? ""}:${ref.end_line ?? ""}:${i}`}
                type="button"
                className="mono"
                style={s.riskRefButton}
                onClick={() => onJumpToFile(ref.path)}
                aria-label={t("fileRefAria", { ref: refLabel(ref) })}
              >
                {refLabel(ref)}
              </button>
            ))}
          </div>
        </div>
        <button
          type="button"
          style={s.riskExpandButton}
          aria-expanded={expanded}
          aria-label={t(expanded ? "risks.collapseAria" : "risks.expandAria", { title: risk.title })}
          onClick={onToggle}
        >
          <Icon.ChevronDown size={16} style={s.riskChevron(expanded)} />
        </button>
      </div>
      {expanded && <p style={s.riskExplanation}>{risk.explanation}</p>}
    </div>
  );
}
