---
"@amodalai/core": patch
"@amodalai/runtime": patch
"@amodalai/react": patch
---

Add user feedback system: thumbs up/down on responses with admin synthesis

- Thumbs up/down on assistant messages in dev UI chat and embedded React widget
- Optional text comment on thumbs down
- Feedback persisted to .amodal/feedback/ as JSON files
- Admin dashboard page with stats, feedback list, and LLM synthesis button
- Admin agent can query feedback via internal_api tool
