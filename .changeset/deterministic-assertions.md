---
"@amodalai/core": patch
"@amodalai/runtime": patch
---

Add deterministic eval assertions — skip LLM judge for programmatic checks

New `key: value` assertion format: contains, regex, starts_with, length_between,
tool_called, tool_not_called, max_latency, max_turns. Plain English assertions
still go to the LLM judge. Both types can be mixed in the same eval.
