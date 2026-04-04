---
"@amodalai/runtime": patch
---

Add agent loop state machine (Phase 3.1). Implements `runAgent()` async generator with discriminated union states (thinking, streaming, executing, confirming, compacting, dispatching, done) and exhaustive transition dispatch. Includes tool pre-execution for read-only tools, parameter sanitization, abort handling, turn budget enforcement, and SSE event emission. Compacting and dispatching states are stubs for Phase 3.3+.
