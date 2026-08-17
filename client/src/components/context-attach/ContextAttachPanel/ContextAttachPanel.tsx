/* ContextAttachPanel — attach/order documents on an agent's or a skill's
   Context tab (mockups 02/03). Shared between /agents/[id] and /skills — two
   consumers in unrelated route trees, so it lives under
   src/components/context-attach/ (frontend-ui-architecture: shared rung),
   not under either route or in @devdigest/ui (that's for domain-free
   primitives; this component is Project-Context-domain-aware). */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Icon, Markdown, Skeleton } from "@devdigest/ui";
import type { ContextOwnerKind } from "@devdigest/shared";
import { useActiveRepo } from "@/lib/repo-context";
import {
  useContextDocument,
  useContextDocuments,
  useOwnerContext,
  useSetOwnerContext,
} from "@/lib/hooks";
import { moveItem, useDragList } from "@/lib/drag-list";
import { buildRows, filterRows, toggleAttach } from "./helpers";
import { s } from "./styles";

export function ContextAttachPanel({
  ownerKind,
  ownerId,
  hint,
}: {
  ownerKind: ContextOwnerKind;
  ownerId: string;
  hint: string;
}) {
  const t = useTranslations("context");
  const { repoId } = useActiveRepo();
  const { data: listing, isLoading: docsLoading } = useContextDocuments(repoId);
  const { data: attachmentSet, isLoading: attachLoading } = useOwnerContext(ownerKind, ownerId);
  const setOwnerContext = useSetOwnerContext();

  const [filter, setFilter] = React.useState("");
  const [previewPath, setPreviewPath] = React.useState<string | null>(null);
  const [announcement, setAnnouncement] = React.useState("");
  const rowRefs = React.useRef(new Map<string, HTMLDivElement>());

  const documents = listing?.documents ?? [];
  const attachments = attachmentSet?.attachments ?? [];
  const attachedPaths = React.useMemo(() => attachments.map((a) => a.path), [attachments]);

  const rows = React.useMemo(() => buildRows(documents, attachments), [documents, attachments]);
  const filtering = filter.trim() !== "";
  const visible = filterRows(rows, filter);

  const persist = (paths: string[]) => {
    if (!repoId) return;
    setOwnerContext.mutate({ kind: ownerKind, ownerId, repoId, paths });
  };

  const toggle = (path: string) => persist(toggleAttach(attachedPaths, path));

  const move = (path: string, direction: -1 | 1) => {
    const from = attachedPaths.indexOf(path);
    const to = from + direction;
    if (from === -1 || to < 0 || to >= attachedPaths.length) return;
    const next = moveItem(attachedPaths, from, to);
    persist(next);
    setAnnouncement(t("reorderAnnounced", { name: path, position: to + 1, total: next.length }));
    // Focus moves with the row's own re-render (its key stays `path`, but the
    // DOM node is recreated at the new list position) — a plain rAF can
    // silently never fire in this app's browser harness (client/insights.md
    // 2026-08-08), so this uses setTimeout instead.
    setTimeout(() => {
      rowRefs.current.get(path)?.focus();
    }, 0);
  };

  const { data: previewDoc, isLoading: previewLoading } = useContextDocument(repoId, previewPath, {
    enabled: !!previewPath,
  });

  const drag = useDragList(attachedPaths, persist);

  if (docsLoading || attachLoading) {
    return (
      <div style={s.wrap}>
        <Skeleton height={22} width={200} />
        <div style={{ height: 16 }} />
        <Skeleton height={160} />
      </div>
    );
  }

  const totalTokens = attachmentSet?.total_tokens ?? 0;
  const overBudget = attachmentSet?.over_budget ?? false;
  const budget = attachmentSet?.budget ?? 0;

  return (
    <div style={s.wrap}>
      <div style={s.header}>
        <h2 style={s.h2}>{t("title")}</h2>
        <span className="mono" style={{ fontSize: 12, color: "var(--text-secondary)" }}>
          {t("attachedCount", { attached: attachedPaths.length, total: documents.length })}
        </span>
        <div style={s.search}>
          <Icon.Search size={12} style={{ color: "var(--text-muted)" }} />
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder={t("filterPlaceholder")}
            aria-label={t("filterPlaceholder")}
            style={s.searchInput}
          />
        </div>
      </div>

      <p style={s.hint}>{filtering ? t("dragDisabledHint") : hint}</p>

      {overBudget && (
        <div style={s.overBudget} role="alert">
          <Icon.AlertTriangle size={14} />
          <span>{t("overBudget", { budget })}</span>
        </div>
      )}

      <div
        role="status"
        aria-live="polite"
        style={s.srOnly}
      >
        {announcement}
      </div>

      {rows.length === 0 ? (
        <p style={s.hint}>{t("empty.title")}</p>
      ) : visible.length === 0 ? (
        // Filter excludes everything: say so rather than rendering a blank box
        // (SPEC-01 Edge cases). Attachments already made are unaffected and
        // still count towards the footer total.
        <p style={s.hint}>{t("noMatch")}</p>
      ) : (
        <div style={s.list}>
          {visible.map((row) => {
            const draggable = row.attached && !row.missing && !filtering;
            const dragProps = draggable ? drag.rowProps(row.path) : {};
            const isPreviewOpen = previewPath === row.path;

            return (
              <React.Fragment key={row.path}>
                <div
                  ref={(el) => {
                    if (el) rowRefs.current.set(row.path, el);
                    else rowRefs.current.delete(row.path);
                  }}
                  {...dragProps}
                  onClick={() => !row.missing && toggle(row.path)}
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      if (!row.missing) toggle(row.path);
                      return;
                    }
                    if (draggable && e.altKey && e.key === "ArrowUp") {
                      e.preventDefault();
                      move(row.path, -1);
                    } else if (draggable && e.altKey && e.key === "ArrowDown") {
                      e.preventDefault();
                      move(row.path, 1);
                    }
                  }}
                  style={s.row(row.attached, drag.over === row.path, drag.dragging === row.path, row.missing)}
                >
                  {/* A real <button>, not the row div, so keyboard reorder still
                      works from a focus stop with an accessible name identifying
                      the action (NFR: reorder handle). Alt+Arrow keydown bubbles
                      to the row's own handler above, so it still moves the row
                      exactly as when the row itself is focused (AC-15). onClick
                      only stops propagation — the row's onClick would otherwise
                      toggle attach on a grip click. Disabled (not just dimmed)
                      when reordering isn't possible, matching AC-14. */}
                  <button
                    type="button"
                    disabled={!draggable}
                    onClick={(e) => e.stopPropagation()}
                    aria-label={t("reorderAria", { name: row.path })}
                    style={s.grip(draggable)}
                  >
                    <Icon.Menu size={14} />
                  </button>
                  {/* The checkbox role, aria-checked and attachAria name live here
                      — a leaf element with only a decorative check icon inside,
                      so it has no interactive descendants (ARIA's
                      presentational-children rule no longer hides the preview
                      button or the grip). The row itself still owns the actual
                      toggle interaction (onClick/onKeyDown above); this element
                      is the accessible state indicator for the attach toggle.
                      It also carries its own `tabIndex={0}`: WAI-ARIA's
                      checkbox pattern requires the element with role="checkbox"
                      to itself be the focusable, operable one — a keyboard/AT
                      user tabbing to a roleless ancestor never hears
                      "checkbox" or its checked state. Enter/Space on this
                      element still toggles via the row's onKeyDown, which
                      receives the bubbled keydown regardless of which
                      descendant holds focus. The row keeps its own tabIndex
                      too (client/insights.md 2026-08-17): removing it would
                      break the reorder focus-retention path (`rowRefs` still
                      points at the row) and the existing keyboard-move test's
                      row selector, which resolves the row via its own
                      `tabindex="0"`. Net: two Tab stops on the state toggle
                      (row, then checkbox) alongside the grip and preview
                      buttons — a broader tab surface than a single-tab-stop
                      redesign would give, accepted here to keep the reorder
                      path and its test untouched. */}
                  <span
                    role="checkbox"
                    aria-checked={row.attached}
                    aria-label={t("attachAria", { attached: row.attached ? "true" : "false", name: row.path })}
                    tabIndex={0}
                    style={s.checkbox(row.attached)}
                  >
                    {row.attached && <Icon.Check size={11} style={s.checkIcon} />}
                  </span>
                  <span className="mono" style={s.name}>
                    {row.path}
                  </span>
                  {row.missing && <span style={s.missingBadge}>{t("missing")}</span>}
                  <span style={s.folderBadge}>{row.folder || "/"}</span>
                  <span style={s.tokenCount}>{t("tokens", { count: row.tokenCount })}</span>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setPreviewPath(isPreviewOpen ? null : row.path);
                    }}
                    aria-label={t("previewAria", { name: row.path })}
                    aria-expanded={isPreviewOpen}
                    style={s.previewBtn}
                  >
                    <Icon.Eye size={12} />
                  </button>
                </div>

                {isPreviewOpen && (
                  <div style={s.preview}>
                    {previewLoading ? (
                      <Skeleton height={60} />
                    ) : (
                      <Markdown>{previewDoc?.text ?? ""}</Markdown>
                    )}
                  </div>
                )}
              </React.Fragment>
            );
          })}
        </div>
      )}

      <div style={s.footer}>
        <span style={s.footerTokens}>≈ {t("tokens", { count: totalTokens })}</span>
        <span style={s.footerNote}>{filtering ? t("dragDisabledHint") : hint}</span>
      </div>
    </div>
  );
}
