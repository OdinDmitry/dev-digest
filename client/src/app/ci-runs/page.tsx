/* Route: /ci-runs — every recorded CI run across the workspace (AC-16). Thin
   route entry; all rendering lives in the colocated CiRunsView. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { AppShell } from "../../components/app-shell";
import { CiRunsView } from "./_components/CiRunsView";

export default function CiRunsPage() {
  const t = useTranslations("ci");
  return (
    <AppShell crumb={[{ label: t("page.crumb") }]}>
      <CiRunsView />
    </AppShell>
  );
}
