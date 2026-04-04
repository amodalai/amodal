---
"@amodalai/runtime": patch
---

Implement Phase 3.3: context compaction, smart snipping, and loop detection upgrade.

**Compaction**: COMPACTING state now summarizes older conversation turns via
generateText with a structured handoff prompt (current state, original task,
key data, actions taken, errors, next steps). Keeps last 6 turns verbatim.
Circuit breaker trips after 3 consecutive failures — continues without
compaction rather than crashing.

**Smart snipping**: Tool results exceeding 20K chars are snipped to keep the
first and last 2K chars with a [snipped] marker. Replaces the blunt 40K hard
truncation from Phase 3.1.

**Loop detection upgrade**: Now checks parameter similarity, not just tool name
frequency. Calls with the same keys and >50% identical values are grouped as
similar, catching retry loops where only one parameter changes.

**SSE events**: Adds `compaction_start` and `compaction_end` events so the UI
can show compaction status and token savings.
