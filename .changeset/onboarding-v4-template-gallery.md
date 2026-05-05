---
"@amodalai/studio": patch
---

Studio template gallery (Onboarding v4 — Phase 3).

Two new routes under `/agents/:agentId/`:

- **`/browse`** — full marketplace gallery. Free-text search over title, tagline, platforms, and tags; category tabs derived from the catalog. Click a card to drill in.
- **`/browse/:slug`** — template detail page. Two-column layout with the expanded preview (lazy-loaded from `card/preview.json`) on the left and the admin chat on the right. The chat is auto-seeded with `Set me up with the "<title>" template.` on mount so the user lands mid-conversation.

Powered by a new `useTemplateCatalog()` hook that fetches the full marketplace and resolves each template's `card/card.json` from GitHub raw, mirroring the featured-only path. Card-fetch logic is now factored into `template-card-fetcher.ts` and shared with `useFeaturedAgents`.

The chat seed is a placeholder — Phase 4 will replace it with a richer first config question once the admin agent has a `show_preview` tool.
