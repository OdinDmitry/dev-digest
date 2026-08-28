/* RepoChooser — the wizard's target-repository picker (Step 0, AC-19). Built
   fresh rather than reusing `@devdigest/ui`'s SearchableSelect: that
   primitive's trigger is a `<div onClick>` with no `tabIndex`/`role`/
   `onKeyDown` and cannot be opened from the keyboard at all (plan constraint
   7) — changing it would also change the agent model picker and the
   feature-model settings as a side effect of a CI feature (Placement
   decisions). This component is always-visible (filter input above an
   always-visible `listbox`), not a popup.

   Accessibility mechanics (plan's Frozen surface):
   - the text filter is itself the Tab stop; ↑/↓ move the highlighted option,
     Enter selects it, Escape clears the filter text;
   - a `role="listbox"` of `role="option"` buttons;
   - a separate `aria-live="polite"` region announces the match count, but
     only once per completed search (debounced ~300ms) — two keystrokes
     inside the debounce window must not double-announce;
   - an empty result states that nothing matched and leaves the current
     selection UNCHANGED (edge case: "an empty result is not a deselection"
     — this component never calls `onChange` on its own, only on an explicit
     pick). */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import type { Repo } from "@devdigest/shared";
import { useRepos } from "@/lib/hooks";

const ANNOUNCE_DEBOUNCE_MS = 300;

export function RepoChooser({
  value,
  onChange,
  required,
}: {
  value: string | null;
  onChange: (repoId: string) => void;
  required?: boolean;
}) {
  const t = useTranslations("ci");
  const { data: repos } = useRepos();
  const [query, setQuery] = React.useState("");
  const [hi, setHi] = React.useState(0);
  const [announcement, setAnnouncement] = React.useState("");
  const timerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  const all = repos ?? [];
  const q = query.trim().toLowerCase();
  const filtered: Repo[] = q ? all.filter((r) => r.full_name.toLowerCase().includes(q)) : all;

  // Debounced, once-per-completed-search announcement — restart the timer on
  // every keystroke so two changes inside the window produce exactly one
  // final announcement (jsdom has no layout; this is plain setTimeout, no
  // rAF — client/insights.md, Tool & Library Notes 2026-08-04/08-08).
  React.useEffect(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      setAnnouncement(
        filtered.length === 0
          ? t("exportWizard.repoChooser.noMatches")
          : t("exportWizard.repoChooser.matchCount", { n: filtered.length }),
      );
    }, ANNOUNCE_DEBOUNCE_MS);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, filtered.length]);

  React.useEffect(() => {
    setHi((i) => Math.min(i, Math.max(filtered.length - 1, 0)));
  }, [filtered.length]);

  function pick(r: Repo) {
    onChange(r.id);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHi((i) => Math.min(i + 1, Math.max(filtered.length - 1, 0)));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHi((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const r = filtered[hi];
      if (r) pick(r);
    } else if (e.key === "Escape") {
      e.preventDefault();
      setQuery("");
    }
  }

  const listboxId = "repo-chooser-listbox";

  return (
    <div>
      <label htmlFor="repo-chooser-filter" style={{ fontSize: 13, fontWeight: 600, color: "var(--text-secondary)", display: "block", marginBottom: 8 }}>
        {t("exportWizard.repoLabel")}
        {required && <span style={{ color: "var(--crit)", marginLeft: 4 }}>*</span>}
      </label>
      <input
        id="repo-chooser-filter"
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={onKeyDown}
        placeholder={t("exportWizard.repoChooser.filterPlaceholder")}
        aria-controls={listboxId}
        autoComplete="off"
        style={{
          width: "100%",
          padding: "10px 12px",
          borderRadius: 7,
          border: "1px solid var(--border-strong)",
          background: "var(--bg-elevated)",
          color: "var(--text-primary)",
          fontSize: 14,
          outline: "none",
        }}
      />
      <div
        id={listboxId}
        role="listbox"
        aria-label={t("exportWizard.repoChooser.listboxLabel")}
        style={{
          marginTop: 8,
          maxHeight: 220,
          overflowY: "auto",
          border: "1px solid var(--border)",
          borderRadius: 7,
        }}
      >
        {filtered.length === 0 ? (
          <div style={{ padding: "10px 12px", fontSize: 13, color: "var(--text-muted)" }}>
            {t("exportWizard.repoChooser.noMatches")}
          </div>
        ) : (
          filtered.map((r, i) => {
            const selected = r.id === value;
            return (
              <button
                key={r.id}
                id={`repo-chooser-option-${r.id}`}
                type="button"
                role="option"
                aria-selected={selected}
                onMouseEnter={() => setHi(i)}
                onClick={() => pick(r)}
                className="mono"
                style={{
                  display: "block",
                  width: "100%",
                  textAlign: "left",
                  padding: "8px 12px",
                  minHeight: 24,
                  border: "none",
                  background: i === hi ? "var(--bg-hover)" : selected ? "var(--accent-bg)" : "transparent",
                  color: selected ? "var(--accent)" : "var(--text-primary)",
                  fontSize: 13,
                  cursor: "pointer",
                }}
              >
                {r.full_name}
              </button>
            );
          })
        )}
      </div>
      <div aria-live="polite" style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0,0,0,0)", whiteSpace: "nowrap" }}>
        {announcement}
      </div>
    </div>
  );
}
