---
"@amodalai/core": patch
"@amodalai/runtime": patch
"@amodalai/amodal": patch
---

Add prompt caching, multi-model eval comparison, and new provider support

- Anthropic prompt caching: system prompt and tools sent with cache_control, 90% input cost savings on cache hits
- Cache-aware cost tracking throughout eval system with savings display
- Multi-model eval comparison: run evals against multiple models side-by-side with color-graded time/cost table
- Per-eval history with assertion breakdown, model info, and collapsible UI
- DeepSeek and Groq provider support via OpenAI-compatible endpoints
- Configurable eval timeout (20s–300s slider)
- Tool results now visible in eval output for judge verification
- Improved judge prompt for specific, evidence-based failure reasoning
- Auth/rate-limit errors surfaced with actionable UI messaging
- ConfigWatcher no longer triggers reload spam from eval result writes
- Session reuse during eval runs to minimize MCP reconnections
