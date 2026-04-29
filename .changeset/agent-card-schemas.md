---
"@amodalai/types": patch
"@amodalai/core": patch
"@amodalai/studio": patch
---

Add agent card foundations (Onboarding v4 — Phase 1).

A template surfaces in the Studio gallery by shipping `card/card.json` (thumbnail) and optionally `card/preview.json` (expanded view) — a curated 2-4 turn conversation snippet that shows what the agent actually says, instead of a feature list.

- `@amodalai/types` — `AgentCard`, `AgentCardPreview`, `AgentCardTurn` interfaces.
- `@amodalai/core` — Zod schemas (`AgentCardSchema`, `AgentCardPreviewSchema`), parsers (`parseAgentCardJson`, `parseAgentCardPreviewJson`), and loaders (`loadAgentCard`, `loadAgentCardPreview`) that read from `<templateRoot>/card/`. Templates without a `card/` directory load as `null` rather than throwing.
- `@amodalai/studio` — `<AgentCard>` presentational component (thumbnail + expanded variants) used by the gallery grid and inline in admin chat.

No user-visible changes yet. Phase 2 (home screen) wires the renderer into routes and adds the `?featured=true` filter.
