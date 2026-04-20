---
"@amodalai/react": patch
"@amodalai/runtime-app": patch
"@amodalai/studio": patch
---

Reconcile ChatWidget and ChatPage: add markdown rendering (react-markdown), image paste, confirmation cards, feedback buttons, and elapsed timer to ChatWidget. Replace runtime-app's custom ChatPage with thin wrapper around ChatWidget. Replace Studio's AdminChat with ChatWidget (custom streamFn support). Delete Studio's duplicate ToolCallCard. Add shared FormattedMarkdown component.
