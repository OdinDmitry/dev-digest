/* LiveStateAnnouncer — an aria-live="polite" region announcing each
   column's new state as it changes (AC-23). Renders a non-focusable node
   and never calls `.focus()`, so keyboard focus never moves. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import type { AgentColumn } from "@devdigest/shared";

const VISUALLY_HIDDEN: React.CSSProperties = {
  position: "absolute",
  width: 1,
  height: 1,
  padding: 0,
  margin: -1,
  overflow: "hidden",
  clip: "rect(0, 0, 0, 0)",
  whiteSpace: "nowrap",
  border: 0,
};

export function LiveStateAnnouncer({ columns }: { columns: AgentColumn[] }) {
  const t = useTranslations("runs");
  const [message, setMessage] = React.useState("");
  const prevStatuses = React.useRef<Map<string, AgentColumn["status"]>>(new Map());

  React.useEffect(() => {
    const prev = prevStatuses.current;
    for (const column of columns) {
      const before = prev.get(column.run_id);
      if (before !== undefined && before !== column.status) {
        setMessage(
          t("column.announce", {
            agent: column.agent_name,
            state: t(`column.state.${column.status}`),
          }),
        );
      }
    }
    prevStatuses.current = new Map(columns.map((c) => [c.run_id, c.status]));
  }, [columns, t]);

  return (
    <div aria-live="polite" style={VISUALLY_HIDDEN}>
      {message}
    </div>
  );
}
