---
"@amodalai/amodal": patch
"@amodalai/runtime": patch
"@amodalai/react": patch
---

Display token usage in the web chat UI. Tracks cumulative input/output tokens across all turns in a session. Usage data flows from LLM provider → agent runner → SSE done event → react hook → UI.
