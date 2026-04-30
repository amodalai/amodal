---
"@amodalai/runtime": patch
"@amodalai/react": patch
---

Runtime: Disable tool loop detection by default (all thresholds set to 0). The maxTurns limit (default 50) is sufficient to prevent runaway loops. Loop detection can be re-enabled by setting non-zero values.

React: Block send during streaming with shake feedback. Text stays in input box until stream ends. Silent 404 on session resume (starts fresh instead of error).
