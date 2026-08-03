# Next.js App Router — Organization

Placement rules specific to the App Router. For *how* RSC, caching, metadata and streaming
work, use the `next-best-practices` skill — this file only answers where things go.

Contents:
1. [Pick one strategy](#1-pick-one-strategy)
2. [The recommended layout](#2-the-recommended-layout)
3. [Colocation, private folders, route groups](#3-colocation-private-folders-route-groups)
4. [The server/client boundary](#4-the-serverclient-boundary)
5. [Server Actions, route handlers, config](#5-server-actions-route-handlers-config)
6. [Review checklist](#6-review-checklist)

---

## 1. Pick one strategy

Next.js is explicitly unopinionated here and sanctions three strategies:

1. **Project files outside `app/`** — `app/` is routing only, everything else in `src/`.
2. **Project files in top-level folders inside `app/`** — `app/components/`, `app/lib/`.
3. **Split by route** — shared code at the `app/` root, route-specific code in the segment.

Any of them works. Mixing them does not: two developers will disagree about where a file
goes and both will be right. Choose one, write it down, and be consistent.

**Recommendation: strategy 1, plus route-local colocation for genuine one-offs.** It keeps
routing legible — you can read `app/` as a sitemap — and it keeps features portable, since
a feature folder has no dependency on the URL structure it currently happens to serve.

---

## 2. The recommended layout

```
src/
├── app/                              # routing + composition ONLY
│   ├── layout.tsx
│   ├── (marketing)/
│   │   ├── layout.tsx
│   │   └── page.tsx
│   ├── (app)/
│   │   ├── layout.tsx
│   │   └── billing/
│   │       ├── page.tsx              # thin: fetch + compose feature components
│   │       ├── loading.tsx
│   │       ├── error.tsx
│   │       └── _components/          # route-local one-offs, not routable
│   │           └── billing-header.tsx
│   └── api/
│       └── webhooks/stripe/route.ts
├── features/billing/…                # the real code
├── components/ui/
├── lib/
├── utils/
├── config/
└── types/
```

**`page.tsx` should be thin.** Its job is: read params, fetch or delegate fetching, compose
feature components, set metadata. When a `page.tsx` grows real logic, that logic isn't
route-specific — it's feature code that happens to be rendered by this route, and it will
be needed by a second route sooner than you think.

Route files that *do* belong in `app/`: `layout`, `template`, `loading`, `error`,
`not-found`, `default`, `route`, and the metadata file conventions (`opengraph-image`,
`sitemap`, `robots`, icons). These are framework contracts tied to a URL, not feature code.

---

## 3. Colocation, private folders, route groups

**Colocation is safe by default.** A route is not publicly accessible until the segment
contains `page.tsx` or `route.ts`, and only what `page`/`route` returns is sent to the
client. So you can put files inside `app/` without accidentally creating URLs.

**`_private-folder/`** — underscore prefix opts the folder and everything under it out of
routing. Since colocation already works, this is not required; use it because it:

- separates UI from routing at a glance,
- sorts predictably in editors,
- and — the real reason — protects you from a future Next.js file convention colliding with
  a folder you named `components`.

Convention: route-local UI goes in `app/<route>/_components/`, route-local helpers in
`app/<route>/_lib/`. The moment a second route needs one of them, it moves to a feature.

**`(route-group)/`** — parentheses organize without affecting the URL. Use for:

- grouping by section, intent, or owning team (`(marketing)` / `(app)` / `(admin)`),
- giving a subset of routes a different layout,
- multiple root layouts (remove the top-level `layout.tsx`, add one per group — each needs
  its own `<html>`/`<body>`),
- scoping a `loading.tsx` to one page instead of the whole segment.

**`src/`** — keeps application code out of the config-file clutter at the repo root. Use it.

---

## 4. The server/client boundary

This is the highest-impact structural decision in an App Router app, because `'use client'`
is not a per-file switch — it marks a boundary, and **everything imported below it becomes
client code and ships to the browser.**

Rules:

- **Server by default.** Components are Server Components unless marked. Don't add
  `'use client'` defensively.
- **Push the boundary down.** Put `'use client'` on small interactive leaves — the form,
  the dropdown, the chart — not on a layout or page that then drags its entire subtree
  client-side.
- **Compose instead of importing across the boundary.** A Client Component can render
  Server Components passed as `children` or props, but not ones it imports. Passing them in
  keeps the server part on the server.
- **Server: layouts, pages, data fetching, static content, anything reading a DB, CMS or
  secret. Client: controlled inputs, event handlers, animations, `window`/`document`,
  subscriptions, browser-only libraries.**
- A healthy tree is overwhelmingly server. If most files carry `'use client'`, the boundary
  was drawn too high — look for one high-up directive causing it rather than fixing files
  one by one.
- `'use client'` does **not** disable SSR. Client Components still render to HTML on the
  server for the initial request; the directive controls hydration and bundling, not
  rendering location.

Structurally this means a feature usually contains both kinds of file, and that's correct:
`features/billing/components/invoice-table.tsx` (server) and
`invoice-filters.tsx` (`'use client'`) sit side by side. Don't split features into
`server/` and `client/` folders — that groups by technical trait, which is the mistake
this whole skill exists to avoid.

---

## 5. Server Actions, route handlers, config

**Server Actions** belong with their feature — `features/<x>/api/actions.ts` or
`features/<x>/actions.ts` — not in a global `actions/` bucket. They're data access for a
domain, and the colocation rule applies unchanged. Route-local one-offs may live in
`app/<route>/_actions.ts`.

**Route handlers** (`app/api/**/route.ts`) are routing surface, so they live in `app/`. Keep
them thin for the same reason as pages: parse the request, call into the feature, serialize
the response. Webhook signature verification and payload handling are feature logic.

**Env and config** — a validated `src/config/env.ts` parsing `process.env` through a Zod
schema, with a deliberate client/server split so a server-only secret cannot be pulled into
a client bundle by an accidental import. Import it in `next.config.ts` so a misconfigured
environment fails the build rather than a request. This is what the `t3-env` package
automates; hand-rolling it with Zod is equally fine.

> **This repo:** DevDigest keeps secrets (LLM keys, `GITHUB_TOKEN`) in
> `~/.devdigest/secrets.json` at mode `0600` — never in git, `.env`, or the database. Follow
> that; the generic env advice above applies to non-secret configuration.

---

## 6. Review checklist

1. Is `page.tsx` thin — params, fetch, compose, metadata — or has feature logic leaked in?
2. Is `'use client'` on a leaf, or is it dragging a subtree into the bundle?
3. Does a Client Component *import* something that should have been passed as `children`?
4. Is route-local UI in `_components/`, and would it need to move if the URL changed?
5. Are route groups used for organization, or are they encoding something that belongs in a
   feature name?
6. Is any secret reachable from a module that a Client Component imports?
7. Is the project mixing two of the three organization strategies?
