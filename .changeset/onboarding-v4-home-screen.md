---
"@amodalai/studio": patch
---

Studio home screen (Onboarding v4 — Phase 2).

The agent index route (`/agents/:agentId/`) now opens to a home screen with three zones — featured agents, admin chat, and a "Browse all →" link to the gallery — instead of the model-pricing dashboard. The dashboard is still reachable at `/agents/:agentId/overview`.

- New `<HomePage>` page in `src/pages/HomePage.tsx`.
- New `useFeaturedAgents()` hook fetches `${registryUrl}/api/templates?featured=true` and resolves each template's `card/card.json` from GitHub raw. Templates without a card are silently dropped.
- New `registryUrl` field on `StudioConfig`, defaulting to `https://api.amodalai.com`. Self-hosted instances override via `REGISTRY_URL`.
- Sidebar gains a "Home" entry; the existing "Overview" link points at the dashboard.
- Clicking "Use this →" on a card seeds the admin chat with `Set me up with the "<title>" template.` Phase 3 will replace this with an expanded preview page.
