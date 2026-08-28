/* Route: /multi-agent (Configure a Multi-Agent Review). Thin route entry —
   PR + agent selection, estimates and the start control live in the
   colocated ConfigureRun component. */
"use client";

import { AppShell } from "@/components/app-shell";
import { ConfigureRun } from "./_components/ConfigureRun";

export default function ConfigureMultiAgentRunPage() {
  return (
    <AppShell crumb={[{ label: "Multi-Agent Review" }, { label: "Configure run" }]}>
      <ConfigureRun />
    </AppShell>
  );
}
