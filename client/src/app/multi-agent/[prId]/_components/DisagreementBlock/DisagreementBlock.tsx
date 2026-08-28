/* DisagreementBlock — "Where agents disagree" (design ref 04/05). Each row
   is headed by its location alone (file:start_line[-end_line]) — no
   synthesized label (Edge cases). One cell per take: agent name, severity
   as text + colour (NFR), and its note verbatim; `verdict === 'ignored'`
   renders only `conflicts.didNotFlag`, never a generated rationale
   (AC-19, Non-goals). The "only conflicts" toggle filters server-computed
   `is_conflict` rows client-side — it never recomputes the flag (AC-22). */
"use client";

import { useTranslations } from "next-intl";
import { Checkbox } from "@devdigest/ui";
import type { Conflict } from "@devdigest/shared";
import { SEV_COLOR, SEV_COLOR_FALLBACK } from "@/lib/severity";
import { s } from "./styles";

function locationLabel(row: Conflict): string {
  return row.start_line === row.end_line
    ? `${row.file}:${row.start_line}`
    : `${row.file}:${row.start_line}-${row.end_line}`;
}

export function DisagreementBlock({
  conflicts,
  onlyConflicts,
  onToggle,
}: {
  conflicts: Conflict[];
  onlyConflicts: boolean;
  onToggle: (value: boolean) => void;
}) {
  const t = useTranslations("runs");

  const shown = onlyConflicts ? conflicts.filter((row) => row.is_conflict) : conflicts;

  return (
    <section style={s.section}>
      <div style={s.headerRow}>
        <span style={s.title}>{t("conflicts.title")}</span>
        <Checkbox checked={onlyConflicts} onChange={onToggle} label={t("conflicts.onlyConflicts")} />
      </div>

      {conflicts.length === 0 ? (
        <div style={s.empty}>{t("conflicts.emptyAll")}</div>
      ) : shown.length === 0 ? (
        <div style={s.empty}>{t("conflicts.empty")}</div>
      ) : (
        <div style={s.rows}>
          {shown.map((row) => (
            <div key={`${row.file}:${row.start_line}:${row.end_line}`} style={s.row}>
              <div style={s.location}>{locationLabel(row)}</div>
              <div style={s.takes}>
                {row.takes.map((take) => {
                  const color =
                    take.verdict === "ignored" ? SEV_COLOR_FALLBACK : (SEV_COLOR[take.verdict] ?? SEV_COLOR_FALLBACK);
                  return (
                    <div key={take.agent_id} style={{ ...s.take, ...s.takeBorder(color) }}>
                      <div style={s.agentName}>{take.agent_name ?? take.agent_id}</div>
                      {take.verdict === "ignored" ? (
                        <div style={s.ignored}>{t("conflicts.didNotFlag")}</div>
                      ) : (
                        <>
                          <div style={s.severity(color)}>{t(`severity.${take.verdict.toLowerCase()}`)}</div>
                          <div style={s.note}>{take.note}</div>
                        </>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
