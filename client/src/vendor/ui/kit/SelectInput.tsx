import React from "react";
import { Icon } from "../icons";

/** REAL controlled <select>. */
export function SelectInput({
  value,
  onChange,
  options,
  mono = true,
}: {
  value: string;
  onChange?: (v: string) => void;
  options: (string | { value: string; label: string })[];
  mono?: boolean;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "10px 12px",
        borderRadius: 7,
        border: "1px solid var(--border-strong)",
        background: "var(--bg-elevated)",
        position: "relative",
      }}
    >
      <select
        className={mono ? "mono" : undefined}
        value={value}
        onChange={(e) => onChange?.(e.target.value)}
        style={{
          flex: 1,
          fontSize: 14,
          color: "var(--text-primary)",
          background: "transparent",
          border: "none",
          outline: "none",
          appearance: "none",
          cursor: "pointer",
        }}
      >
        {options.map((o) => {
          const v = typeof o === "string" ? o : o.value;
          const l = typeof o === "string" ? o : o.label;
          return (
            // The popup list is painted by the browser, not by our wrapper, so
            // it does NOT inherit `--bg-elevated` — without an explicit
            // background each option renders light `--text-primary` on the
            // browser's own white, i.e. invisible in the dark theme.
            <option
              key={v}
              value={v}
              style={{ background: "var(--bg-elevated)", color: "var(--text-primary)" }}
            >
              {l}
            </option>
          );
        })}
      </select>
      <Icon.ChevronsUpDown size={14} style={{ color: "var(--text-muted)", pointerEvents: "none" }} />
    </div>
  );
}
