---
"@amodalai/runtime": patch
"@amodalai/studio": patch
---

Lifecycle + power-user surfaces (Onboarding v4 — Phase 5).

**View config toggle.** New toggle in `SystemPage` (localStorage-backed, off by default). When on, the sidebar surfaces the GettingStarted form and per-connection configure pages — the v4 home-first flow stays the user-facing default; ISVs and power users flip the bit when they need the underlying config UI back.

**Template update notifications.**

- New runtime endpoint `GET /api/package-updates` walks `amodal.json#packages`, reads each installed version from `node_modules/<pkg>/package.json`, runs `npm view <pkg> version` for the latest, and returns `{name, installed, latest, hasUpdate}` per package. Results are cached in-memory for 24 hours.
- New `POST /api/package-updates/install` runs `npm install <pkg>@latest` and invalidates the cache.
- New `GET /api/package-card?name=…` reads the installed `node_modules/<pkg>/card/card.json` for the diff page.
- Studio polls on home-screen mount via `usePackageUpdates`. When any package has an update, an inline banner above the popular-agents row links to the diff page.

**See-what-changed page** at `/agents/:agentId/updates/:slug`. Shows the package's currently-installed `card.json`, the version delta (installed → latest), and an "Update" button that POSTs the install. After install, the user is told to reload Studio to see the new card.
