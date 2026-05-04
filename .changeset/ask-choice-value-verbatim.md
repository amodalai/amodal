---
"@amodalai/react": patch
---

`AskChoiceCard` now posts the picked option's `value` verbatim as the user turn, instead of translating it back to the `label`.

The old behavior assumed `value` was an opaque internal id (e.g. `@amodalai/connection-hubspot`) that shouldn't show in chat. Now that intent routing matches on user messages, the `value` IS the user's effective utterance — agent authors compose it as a readable phrase ("Use HubSpot as the CRM") and the chat reads naturally while the intent layer can regex-match it.

This unblocks the end-to-end intent flow for `ask_choice` slot picks: clicking a button posts the value verbatim → the intent matcher catches it → deterministic tool work runs in milliseconds, no LLM round-trip needed.
