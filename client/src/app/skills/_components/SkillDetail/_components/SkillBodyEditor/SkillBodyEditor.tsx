/* SkillBodyEditor — a line-numbered, monospace text editor for a skill's
   markdown body. No syntax highlighting (a deliberate scope cut — no new
   dependency), just a scroll-synced gutter, a filename/unsaved/token strip.

   Uses a RAW <textarea>, not the kit's <Textarea>: that component accepts only
   {value, onChange, placeholder, rows, mono} — no style, no ref, no onScroll,
   and a hard-coded fontSize/lineHeight. A synced gutter needs all four. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge, Icon } from "@devdigest/ui";
import { approxTokens } from "../../../../../../lib/tokens";
import { s } from "./styles";

export function SkillBodyEditor({
  value,
  onChange,
  filename,
  dirty,
}: {
  value: string;
  onChange: (v: string) => void;
  filename: string;
  dirty: boolean;
}) {
  const t = useTranslations("skills");
  const gutterRef = React.useRef<HTMLDivElement>(null);

  // "a\n".split("\n") -> ["a", ""], so a trailing newline correctly shows an
  // extra (empty) line number, matching what the textarea renders.
  const lineCount = React.useMemo(() => value.split("\n").length, [value]);
  const tokens = React.useMemo(() => approxTokens(value), [value]);

  return (
    <div style={s.panel}>
      <div style={s.strip}>
        <Icon.File size={13} style={{ color: "var(--text-muted)" }} />
        <span className="mono" style={s.filename}>
          {filename}
        </span>
        {dirty && (
          <Badge color="var(--warn)" bg="var(--warn-bg)">
            {t("config.unsaved")}
          </Badge>
        )}
        <span className="tnum" style={s.tokenCount}>
          {t("config.tokenCount", { count: tokens })}
        </span>
      </div>
      <div style={s.editorRow}>
        <div ref={gutterRef} style={s.gutter}>
          {Array.from({ length: lineCount }, (_, i) => (
            <div key={i}>{i + 1}</div>
          ))}
        </div>
        <textarea
          className="mono"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onScroll={(e) => {
            // One direction only: the gutter follows vertical scroll but never
            // horizontal, so the numbers stay pinned while the text scrolls.
            if (gutterRef.current) gutterRef.current.scrollTop = e.currentTarget.scrollTop;
          }}
          spellCheck={false}
          wrap="off"
          aria-label={t("preview.bodyLabel")}
          style={s.textarea}
        />
      </div>
    </div>
  );
}
