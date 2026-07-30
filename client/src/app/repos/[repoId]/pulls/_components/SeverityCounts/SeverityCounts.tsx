/* SeverityCounts — "N CRITICAL · N WARNING · N SUGGESTION" readout, shared by
   the PR-list FINDINGS column and the PR-detail timeline row. Optionally
   clickable (single-select toggle) and/or hoverable (popup listing the
   actual findings) — callers opt into either via props. */
"use client";

import React from "react";
import { createPortal } from "react-dom";
import { SeverityBadge, MonoLink, ConfidenceNum } from "@devdigest/ui";
import type { FindingRecord, Severity } from "@devdigest/shared";
import { s } from "./styles";

export type SeverityKey = "critical" | "warning" | "suggestion";

export interface SeverityCountsValue {
  critical: number;
  warning: number;
  suggestion: number;
}

const KEY_TO_SEVERITY: Record<SeverityKey, Severity> = {
  critical: "CRITICAL",
  warning: "WARNING",
  suggestion: "SUGGESTION",
};
const ORDER: SeverityKey[] = ["critical", "warning", "suggestion"];

export function SeverityCounts({
  counts,
  selected = null,
  onSelect,
  popupFindings,
  popupLoading,
  popupHeading,
  onHoverChange,
}: {
  counts: SeverityCountsValue;
  /** Currently-selected severity (single-select toggle); highlights the rest as dimmed. */
  selected?: SeverityKey | null;
  /** Omit to render a non-interactive (display-only) readout — e.g. the timeline row. */
  onSelect?: (key: SeverityKey) => void;
  /** Findings to list in the hover popup; omit/undefined ⇒ no popup at all. */
  popupFindings?: FindingRecord[];
  popupLoading?: boolean;
  /** Appended after "N FINDING(S)" in the popup header, e.g. "in this run". */
  popupHeading?: string;
  /** Fires on hover start/end — lets the caller lazily fetch popup data. */
  onHoverChange?: (hovering: boolean) => void;
}) {
  const rootRef = React.useRef<HTMLDivElement>(null);
  const [hovering, setHovering] = React.useState(false);
  // Fixed-position coords for the portaled popup (viewport-relative, matches
  // getBoundingClientRect() — computed once when the hover starts).
  const [pos, setPos] = React.useState<{ top: number; left: number } | null>(null);
  const total = counts.critical + counts.warning + counts.suggestion;
  const hasPopup = popupFindings !== undefined || popupLoading;

  // Closing is debounced (not instant) so moving the mouse from the trigger
  // to the portaled popup doesn't unmount it mid-transition: the popup is no
  // longer a DOM descendant of the trigger (it's portaled to <body>), so the
  // browser's leave-before-enter event ordering could otherwise remove it
  // from the DOM before its own mouseenter has a chance to fire and cancel
  // the close, permanently hiding the popup. Re-entering (either element)
  // cancels the pending close.
  const closeTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  React.useEffect(() => () => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
  }, []);

  const openPopup = () => {
    if (closeTimer.current) {
      clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
    setHovering(true);
    onHoverChange?.(true);
    const rect = rootRef.current?.getBoundingClientRect();
    if (rect) setPos({ top: rect.bottom, left: rect.left });
  };
  const scheduleClose = () => {
    closeTimer.current = setTimeout(() => {
      setHovering(false);
      onHoverChange?.(false);
    }, 120);
  };

  return (
    <div ref={rootRef} style={s.root} onMouseEnter={openPopup} onMouseLeave={scheduleClose}>
      <div style={s.badges}>
        {total === 0 ? (
          <span style={s.empty}>—</span>
        ) : (
          ORDER.filter((k) => counts[k] > 0).map((k) => (
            <button
              key={k}
              type="button"
              disabled={!onSelect}
              onClick={(e) => {
                e.stopPropagation();
                onSelect?.(k);
              }}
              style={s.badgeBtn(!!onSelect, !!selected && selected !== k)}
            >
              <SeverityBadge severity={KEY_TO_SEVERITY[k]} count={counts[k]} compact />
            </button>
          ))
        )}
      </div>

      {hovering &&
        hasPopup &&
        total > 0 &&
        pos &&
        typeof document !== "undefined" &&
        createPortal(
          // Portaled to <body> so it escapes any ancestor `overflow: hidden`
          // (e.g. the PR-list table card, clipped for its rounded corners).
          // Its own mouse handlers mirror the trigger's — since it's no longer
          // a DOM descendant of the root, hovering INTO the popup needs its
          // own enter/leave to keep it open (flush `top`, no gap, avoids a
          // dead zone between trigger and popup that would close it early).
          <div
            style={{ ...s.popup, position: "fixed", top: pos.top, left: pos.left }}
            onMouseEnter={openPopup}
            onMouseLeave={scheduleClose}
            onClick={(e) => e.stopPropagation()}
          >
            {!popupLoading && (
              <div style={s.popupHeader}>
                {total} FINDING{total === 1 ? "" : "S"}
                {popupHeading ? ` ${popupHeading}` : ""}
              </div>
            )}
            {popupLoading ? (
              <div style={s.popupMuted}>Loading…</div>
            ) : popupFindings && popupFindings.length > 0 ? (
              <div style={s.popupList}>
                {popupFindings.map((f, i) => (
                  <div
                    key={f.id}
                    style={s.popupItem(i === popupFindings.length - 1)}
                  >
                    <div style={s.popupItemHead}>
                      <SeverityBadge severity={f.severity} compact />
                      <span style={s.popupTitle}>{f.title}</span>
                    </div>
                    <div style={s.popupMeta}>
                      <MonoLink>
                        {f.file}:{f.start_line}
                      </MonoLink>
                      <ConfidenceNum value={f.confidence} />
                    </div>
                    <div style={s.popupRationale}>{f.rationale.split("\n")[0]}</div>
                  </div>
                ))}
              </div>
            ) : (
              <div style={s.popupMuted}>No findings.</div>
            )}
          </div>,
          document.body,
        )}
    </div>
  );
}
