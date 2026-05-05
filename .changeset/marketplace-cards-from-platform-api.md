---
"@amodalai/types": patch
"@amodalai/studio": patch
---

Read marketplace card data straight from platform-api.

The Studio gallery (home featured row + browse page) now reads card image, tagline, and platforms directly from `${registryUrl}/api/templates`. No more cross-origin GitHub fetch for `card/card.json` per template, no more stub-catalog fallback.

- `AgentCard` interface gains `imageUrl?: string` and makes `thumbnailConversation?` optional. The `<AgentCard>` component renders the image when present and falls back to the legacy conversation block for self-hosted/legacy templates that still ship `card.json`.
- `useTemplateCatalog` builds cards from the catalog response in one round-trip — no GitHub raw fetches, no stub fallback. Templates without an image still render (text-only card layout); empty registry surfaces honestly via the error string.
- `<PickerCard>` renders the marketplace image when present; the snippet block is the fallback for image-less cards.
- Deleted: `stub-catalog.ts` (~700 lines of in-memory marketplace data) and `template-card-fetcher.ts` (GitHub raw fetcher). The `parseCard` helper moved inline into `TemplateUpdatePage` (only remaining consumer — reads the installed package's local `card.json` for the update-diff page).

Operationally requires platform-api at `api.amodalai.com` (or the configured `registryUrl`) to serve `cardImageUrl` for templates that have one. Templates without an image still appear in the picker; their cards render with title + tagline + platforms only.
