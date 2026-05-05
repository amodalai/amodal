---
"@amodalai/types": patch
"@amodalai/runtime": patch
"@amodalai/react": patch
"@amodalai/studio": patch
---

Plumb marketplace card thumbnails (`imageUrl`) end-to-end so the chat-inline preview and the create-flow detail view both render the image when platform-api ships one.

- `@amodalai/types` — `AgentCard` gains `imageUrl?: string` and makes `thumbnailConversation?` optional. The marketplace image is the canonical visual; the conversation snippet stays as a fallback for self-hosted/legacy templates.
- `@amodalai/runtime` — `SSEShowPreviewEvent.card` mirror gains `imageUrl?` so the inline event carries the URL through unchanged. Drive-by: removed a duplicate `SSEShowPreviewEvent` declaration left over from a prior auto-merge.
- `@amodalai/react` — `AgentCardInline` mirror gains `imageUrl?`. `<AgentCardInlinePreview>` renders the image as a small thumbnail when set (180w × 120h, 3:2 aspect — sits inside chat without dominating). The empty `__convo` div is now hidden when there are no thumbnail turns.
- `@amodalai/studio` — `useTemplateCatalog` builds the agent card from platform-api fields including `cardImageUrl` (mapped to `card.imageUrl`); also synthesizes a partial `detail` from `longDescription` so the detail view renders real copy instead of a placeholder. `<AgentCard>` (gallery) renders the image as a 3:2 hero when present, falling back to the existing conversation block. `<DetailView>` (`CreateFlowPage`) leads with a hero image when set, plus shows the tagline as a subheading. `<PickerCard>` shows the image in place of the snippet block when present. Backend `template-resolve` route now reads `cardImageUrl` and `cardPlatforms` from platform-api and maps them onto the local `card` shape; the legacy `displayName` field still falls back to `name` so the inline preview no longer renders the slug as the title.
