---
"@amodalai/runtime": patch
---

Finish Phase 3 deferred items:

- **Token budget enforcement.** `AgentContext` gains an optional `maxTokens` cap; `runAgent()` checks `usage.totalTokens` between state transitions and terminates with `DoneReason: 'budget_exceeded'` when the cap is hit. Closes the silent-cost-runaway hole where a long-running automation could burn through tokens in a tight retry loop. Sub-agent dispatches inherit the parent's remaining budget.
- **Generalized tool confirmation.** `ToolDefinition` gains a `requiresConfirmation` flag that routes any flagged tool through the existing `CONFIRMING` state, not just connection tools. Approvals are tracked per-session via `ctx.confirmedCallIds`, which also fixes a latent infinite-loop bug in the connection-tool confirmation path where a re-check after approval would re-route back to CONFIRMING.
- **Tool result summarization hook.** `AgentContext.summarizeToolResult` is a new optional hook; when set, context-evicted tool results are replaced with a 1-2 sentence LLM-generated summary instead of the generic `[Tool result cleared]` marker. Idempotent across turns and degrades to the static marker on summarizer failure.
- **Provider-native token counting.** `LLMProvider` gains an optional `countTokens(messages)` method; `estimateTokenCount()` delegates to it when implemented, falling back to the 4-chars-per-token heuristic otherwise. Unlocks accurate compaction boundaries as providers wire native tokenizers.
- **Loop detection escalation tier.** New `loopEscalationThreshold` (default 5) sits between the warning threshold (3) and the hard-stop (8). When hit, the loop emits a stronger system message and removes the looping tool from the tool set for that turn, forcing the agent to try a different approach.
