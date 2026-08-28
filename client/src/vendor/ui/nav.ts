/* nav.ts — sidebar nav groups + keyboard shortcut registry.
   hrefs use :repoId token; the web app fills it from the active repo. */
import type { IconName } from "./icons";

export interface NavItemDef {
  key: string;
  label: string;
  icon: IconName;
  /** Route template; :repoId is replaced with the active repo id by the app. */
  href: string;
  /** Optional g-nav shortcut suffix (e.g. "p" → g then p). */
  gKey?: string;
  badge?: string;
}

export interface NavGroup {
  section: string;
  items: NavItemDef[];
}

export const NAV: NavGroup[] = [
  {
    section: "WORKSPACE",
    items: [
      { key: "pulls", label: "Pull Requests", icon: "GitPullRequest", href: "/repos/:repoId/pulls", gKey: "p" },
      { key: "context", label: "Project Context", icon: "Folder", href: "/repos/:repoId/context", gKey: "x" },
    ],
  },
  {
    // Authoring surface: the reusable skills library, the agents that link
    // it, the repo-scoped conventions extractor that feeds it, and the eval
    // dashboard that scores an agent's cases against those runs.
    section: "SKILLS LAB",
    items: [
      { key: "skills", label: "Skills", icon: "Sparkles", href: "/skills", gKey: "s" },
      { key: "agents", label: "Agents", icon: "Cpu", href: "/agents", gKey: "a" },
      {
        key: "conventions",
        label: "Conventions",
        icon: "ListChecks",
        href: "/repos/:repoId/conventions",
        gKey: "c",
      },
      { key: "eval", label: "Eval Dashboard", icon: "Gauge", href: "/evals", gKey: "e" },
    ],
  },
  {
    section: "GLOBAL",
    items: [
      { key: "multi-agent", label: "Multi-Agent Review", icon: "Users", href: "/multi-agent" },
    ],
  },
];

export const SETTINGS_ITEM: NavItemDef = {
  key: "settings",
  label: "Settings",
  icon: "Settings",
  href: "/settings/api-keys",
  gKey: ",",
};

export const SETTINGS_SECTIONS = [
  { key: "api-keys", label: "API Keys" },
  { key: "models", label: "Feature Models" },
] as const;

/** Keyboard shortcut registry. Wiring is finalized by A6. */
export interface ShortcutDef {
  keys: string;
  label: string;
  group: "Navigation" | "Findings" | "Actions" | "Global";
}

// "g <key>" is a real shortcut only for nav items that declare a gKey — one
// entry per item, derived from NAV so a new nav item never needs a second,
// hand-kept listing here (this file used to enumerate navigation twice: once
// in NAV, once repeated by hand below it).
const NAV_SHORTCUTS: ShortcutDef[] = NAV.flatMap((g) => g.items)
  .filter((it) => it.gKey)
  .map((it) => ({ keys: `g ${it.gKey}`, label: `Go to ${it.label}`, group: "Navigation" as const }));

export const SHORTCUTS: ShortcutDef[] = [
  { keys: "⌘K", label: "Open command palette", group: "Global" },
  { keys: "?", label: "Show keyboard shortcuts", group: "Global" },
  ...NAV_SHORTCUTS,
  { keys: "j / k", label: "Next / previous finding", group: "Findings" },
  { keys: "a", label: "Accept finding", group: "Findings" },
  { keys: "d", label: "Dismiss finding", group: "Findings" },
];

/** Resolve an :repoId-templated href against the active repo id. */
export function resolveHref(href: string, repoId: string | null | undefined): string {
  if (!href.includes(":repoId")) return href;
  return href.replace(":repoId", repoId ?? "_");
}
