import { describe, it, expect } from "vitest";
import { NAV, SHORTCUTS } from "@devdigest/ui";

/**
 * Regression guard for the collapsed shortcut registry (Entry points table,
 * Placement decision — `SHORTCUTS`'s `Navigation` group is DERIVED from
 * `NAV`, not hand-kept, specifically so a new nav item can never again be
 * missing from the shortcuts help overlay). This test must fail if someone
 * reverts `nav.ts` to hand-writing the `Navigation` entries again.
 */
describe("nav shortcut registry", () => {
  it("nav_shortcut_help_derives_from_nav", () => {
    const navItemsWithShortcut = NAV.flatMap((group) => group.items).filter((item) => !!item.gKey);
    const navigationShortcuts = SHORTCUTS.filter((s) => s.group === "Navigation");

    // One entry per NAV item carrying a gKey — no more, no fewer.
    expect(navigationShortcuts).toHaveLength(navItemsWithShortcut.length);

    for (const item of navItemsWithShortcut) {
      const entry = navigationShortcuts.find((s) => s.keys === `g ${item.gKey}`);
      expect(entry, `expected a shortcut entry for "${item.label}" (g ${item.gKey})`).toBeDefined();
      expect(entry?.label).toBe(`Go to ${item.label}`);
    }

    // The new Eval Dashboard entry specifically, named — this is the one
    // T22 added, and the one most likely to go missing if the derivation
    // regresses back to a hand-kept list.
    const evalItem = navItemsWithShortcut.find((item) => item.key === "eval");
    expect(evalItem, "expected NAV to carry the eval dashboard item").toBeDefined();
    expect(navigationShortcuts).toContainEqual({
      keys: `g ${evalItem!.gKey}`,
      label: "Go to Eval Dashboard",
      group: "Navigation",
    });
  });

  it("keeps the eval dashboard nav item's key/href aligned with activeKeyFor's /eval branch", () => {
    // `app-shell/helpers.ts`'s `activeKeyFor` maps pathname `/eval` to key
    // `"eval"` — the NAV item must match both exactly, or the sidebar would
    // never highlight as active while on the Eval Dashboard route.
    const evalItem = NAV.flatMap((group) => group.items).find((item) => item.key === "eval");
    expect(evalItem).toBeDefined();
    expect(evalItem?.href).toBe("/eval");
  });
});
