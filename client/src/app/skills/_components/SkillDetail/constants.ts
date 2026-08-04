import type { IconName } from "@devdigest/ui";

/** Detail-pane tab descriptor. `labelKey` resolves under the `skills` namespace. */
export interface DetailTabDef {
  key: string;
  labelKey: string;
  icon: IconName;
}

/** Exactly Config | Preview | Versions — no Evals/Stats tab, per the mockups. */
export const TABS: readonly DetailTabDef[] = [
  { key: "config", labelKey: "config.tabLabel", icon: "Settings" },
  { key: "preview", labelKey: "preview.tabLabel", icon: "Eye" },
  { key: "versions", labelKey: "versions.tabLabel", icon: "History" },
];
