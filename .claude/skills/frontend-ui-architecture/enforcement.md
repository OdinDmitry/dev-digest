# Enforcing the Architecture

A documented architecture decays; a linted one doesn't. The rules in `SKILL.md` are only
worth writing down if a violation fails in the editor or in CI — otherwise the first
deadline erases them, and nobody notices until the "feature folder" can no longer be moved.

Use both layers if you can:

- **ESLint** — instant in-editor feedback, red squiggle under the bad import. Catches it
  before the commit.
- **dependency-cruiser** — runs in CI, independent of ESLint config drift, and can render
  the dependency graph so violations are visible as a picture.

Contents:
1. [Option A — `import/no-restricted-paths`](#option-a--importno-restricted-paths-simplest)
2. [Option B — `eslint-plugin-boundaries`](#option-b--eslint-plugin-boundaries-scales-better)
3. [dependency-cruiser for CI](#dependency-cruiser-for-ci)
4. [Related rules worth turning on](#related-rules-worth-turning-on)
5. [Rolling it out on an existing codebase](#rolling-it-out-on-an-existing-codebase)

---

## Option A — `import/no-restricted-paths` (simplest)

From `eslint-plugin-import`. Requires no extra concepts: a zone says *files in `target` may
not import from `from`*. Good when you have a handful of features.

```js
// eslint.config.js  (flat config)
import importPlugin from "eslint-plugin-import";

export default [
  {
    plugins: { import: importPlugin },
    rules: {
      "import/no-restricted-paths": [
        "error",
        {
          zones: [
            // ── Shared layer must not know about features or routing ──
            {
              target: [
                "./src/components",
                "./src/lib",
                "./src/utils",
                "./src/config",
                "./src/types",
              ],
              from: ["./src/features", "./src/app"],
              message:
                "Shared code must stay domain-agnostic. Move the domain-specific part into the feature.",
            },

            // ── Features must not depend on routing ──
            {
              target: "./src/features",
              from: "./src/app",
              message:
                "Routing consumes features, never the other way round. Compose at the page level.",
            },

            // ── No cross-feature imports (one entry per feature) ──
            {
              target: "./src/features/auth",
              from: "./src/features",
              except: ["./auth"],
            },
            {
              target: "./src/features/billing",
              from: "./src/features",
              except: ["./billing"],
            },
            {
              target: "./src/features/projects",
              from: "./src/features",
              except: ["./projects"],
            },
          ],
        },
      ],
    },
  },
];
```

The cross-feature block needs one entry per feature, which is its main weakness — it's easy
to forget an entry when adding a feature, and a missing entry fails open. If features are
added often, prefer Option B.

---

## Option B — `eslint-plugin-boundaries` (scales better)

Declare element *types* once; the rules then apply to every feature automatically, including
ones added tomorrow.

```js
// eslint.config.js
import boundaries from "eslint-plugin-boundaries";

export default [
  {
    plugins: { boundaries },
    settings: {
      "boundaries/include": ["src/**/*"],
      "boundaries/elements": [
        { type: "app",     pattern: "src/app/**" },
        { type: "feature", pattern: "src/features/*", capture: ["featureName"] },
        { type: "shared",  pattern: "src/(components|lib|utils|config|types)/**" },
      ],
    },
    rules: {
      "boundaries/element-types": [
        "error",
        {
          default: "disallow",
          rules: [
            // Routing composes features and uses shared code.
            { from: "app",     allow: ["feature", "shared", "app"] },
            // A feature may use shared code and itself — never a sibling.
            { from: "feature", allow: ["shared", ["feature", { featureName: "${from.featureName}" }]] },
            // Shared knows nothing above it.
            { from: "shared",  allow: ["shared"] },
          ],
        },
      ],
      // Outsiders enter a feature only through its public API.
      "boundaries/entry-point": [
        "error",
        {
          default: "disallow",
          rules: [
            { target: ["feature"], allow: "index.ts" },
            { target: ["shared"],  allow: "**" },
          ],
        },
      ],
    },
  },
];
```

`boundaries/entry-point` is what makes the one-barrel-per-feature rule real: without it,
`index.ts` is a suggestion, and someone will import
`@/features/billing/components/internal-thing` at 5pm on a Friday.

---

## dependency-cruiser for CI

```js
// .dependency-cruiser.js
module.exports = {
  forbidden: [
    {
      name: "shared-no-features",
      severity: "error",
      comment: "Shared code must not depend on features or routing.",
      from: { path: "^src/(components|lib|utils|config|types)/" },
      to:   { path: "^src/(features|app)/" },
    },
    {
      name: "features-no-app",
      severity: "error",
      comment: "Features must not depend on routing.",
      from: { path: "^src/features/" },
      to:   { path: "^src/app/" },
    },
    {
      name: "no-cross-feature",
      severity: "error",
      comment: "Features must not import siblings. Compose at the page level.",
      from: { path: "^src/features/([^/]+)/" },
      to:   { path: "^src/features/([^/]+)/", pathNot: "^src/features/$1/" },
    },
    {
      name: "feature-public-api-only",
      severity: "error",
      comment: "Enter a feature through its index only.",
      from: { pathNot: "^src/features/([^/]+)/" },
      to:   { path: "^src/features/([^/]+)/.+", pathNot: "^src/features/[^/]+/index\\.(ts|tsx)$" },
    },
    { name: "no-circular", severity: "error", from: {}, to: { circular: true } },
    { name: "no-orphans",  severity: "warn",  from: { orphan: true, pathNot: "\\.d\\.ts$" }, to: {} },
  ],
  options: {
    doNotFollow: { path: "node_modules" },
    tsConfig: { fileName: "tsconfig.json" },
  },
};
```

```bash
npx depcruise src --config .dependency-cruiser.js
```

`no-circular` earns its place on its own — circular imports are the usual symptom of a
boundary that was crossed in both directions, and they produce initialization bugs that are
miserable to debug.

Generating the graph is worth doing once per quarter; a picture makes an eroding boundary
obvious in a way a passing lint run never does:

```bash
npx depcruise src --config .dependency-cruiser.js --output-type dot | dot -T svg > deps.svg
```

---

## Related rules worth turning on

```js
// Ban deep relative paths — they encode the current location, so moving a folder
// rewrites every import inside it.
"no-restricted-imports": ["error", { patterns: ["../../*"] }],

// Enforce type-only imports so types never keep runtime code alive in the bundle.
"@typescript-eslint/consistent-type-imports": "error",
```

Plus path aliases in `tsconfig.json`:

```json
{ "compilerOptions": { "baseUrl": ".", "paths": { "@/*": ["./src/*"] } } }
```

For Next.js, `optimizePackageImports` in `next.config.ts` reduces the build cost of
third-party barrel files — useful, but not a licence to add your own.

---

## Rolling it out on an existing codebase

A rule set that fails 400 times on day one gets disabled on day two.

1. Add the config with every rule at `"warn"`.
2. Count the violations per rule (`npx eslint src -f json`) and fix the cheapest rule first
   — usually `shared-no-features`, since those are typically a handful of stray imports.
3. Flip each rule to `"error"` as its count reaches zero. Rule by rule, not all at once.
4. Add `depcruise` to CI only after ESLint is clean, so the two never disagree.

Every violation you fix is also a small piece of evidence about which boundaries were wrong
in the first place — if one rule fires constantly and every fix feels artificial, the
boundary may be drawn in the wrong place rather than the code being wrong.
