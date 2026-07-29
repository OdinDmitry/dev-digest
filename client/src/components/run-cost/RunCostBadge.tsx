/* RunCostBadge — displays an agent run's LLM $ cost. Two variants:
   "compact" (just the cost, for the PR-list COST column) and "detailed"
   (tokens + cost, for the PR-detail agent-runs timeline row). */

import React from "react";
import { formatCost } from "@/lib/format-cost";

const compactStyle: React.CSSProperties = {
  fontSize: 12,
  color: "var(--text-muted)",
};

const detailedStyle: React.CSSProperties = {
  fontSize: 11,
  color: "var(--text-muted)",
};

export function RunCostBadge({
  costUsd,
  tokensIn,
  tokensOut,
  variant,
}: {
  costUsd: number | null | undefined;
  tokensIn?: number | null;
  tokensOut?: number | null;
  variant: "compact" | "detailed";
}) {
  const cost = formatCost(costUsd);
  if (variant === "compact") {
    return (
      <span className="tnum" style={compactStyle}>
        {cost}
      </span>
    );
  }
  const totalTokens = (tokensIn ?? 0) + (tokensOut ?? 0);
  return (
    <span className="tnum" style={detailedStyle}>
      {totalTokens.toLocaleString()} tok · {cost}
    </span>
  );
}

export default RunCostBadge;
