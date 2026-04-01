---
"@amodalai/core": patch
"@amodalai/runtime": patch
---

Fix eval token counting, prompt context, judge accuracy, and tool result handling

- Fix prompt regression: include skills, knowledge, and connection API docs in system prompt (were silently dropped by session manager refactor)
- Fix token counting: accumulate usage across multiple done events, route Google through MPCG adapter for consistent counts, emit usage on all Done event paths
- Fix judge: direct LLM calls instead of full agent session (90% cheaper), grade text response quality not tool results, require specific evidence
- Fix tool results: remove all truncation (session runner 2K, SSE 500, eval route 4K), pass full output to judge
- Fix request tool: coerce params to strings (prevents "must be string" schema errors), relax additionalProperties constraint
- Add collapsible tool results in UI (2-line preview, click to expand)
- Add elapsed timer with running/judging phase indicator
- Add DeepSeek/Groq providers and model pricing
- Prompt improvements: answer directly before analyzing, retry with different params on empty results
