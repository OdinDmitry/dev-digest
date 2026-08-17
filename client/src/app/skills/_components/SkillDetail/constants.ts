import type { IconName } from "@devdigest/ui";

/** Detail-pane tab descriptor. `labelKey` resolves under the `skills` namespace. */
export interface DetailTabDef {
  key: string;
  labelKey: string;
  icon: IconName;
}

/** Config | Context | Preview | Versions — no Evals/Stats tab, per the
 *  mockups. Context sits between Config and Preview (mockup 03). Its
 *  `labelKey` resolves under the `context` namespace, not `skills` — see
 *  SkillDetail.tsx. */
export const TABS: readonly DetailTabDef[] = [
  { key: "config", labelKey: "config.tabLabel", icon: "Settings" },
  { key: "context", labelKey: "context.tabLabel", icon: "Folder" },
  { key: "preview", labelKey: "preview.tabLabel", icon: "Eye" },
  { key: "versions", labelKey: "versions.tabLabel", icon: "History" },
];
