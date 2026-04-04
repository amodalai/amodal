/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

/**
 * COMPACTING state handler.
 *
 * Summarizes older conversation turns to free context space:
 * 1. Keep the last N turns verbatim (active conversation)
 * 2. Send older turns to a cheap model for structured summarization
 * 3. Replace old turns with the summary
 * 4. Circuit breaker: after N consecutive failures, give up and continue
 *
 * The summary is structured as a handoff document with sections for
 * current state, original task, key data, actions taken, errors, and
 * next steps. This preserves the information the agent needs to
 * continue working without the full conversation history.
 */

import {SSEEventType} from '../../types.js';
import type {SSEEvent} from '../../types.js';
import type {ModelMessage} from 'ai';
import {CompactionError} from '../../errors.js';
import type {Result} from '../../errors.js';
import type {
  CompactingState,
  AgentContext,
  TransitionResult,
} from '../loop-types.js';
import {estimateTokenCount} from '../token-estimate.js';

/** Prefix for the summary message injected after compaction. */
const COMPACTION_SUMMARY_PREFIX = '[Conversation Summary — older messages compacted]';

/** Timeout for the compaction generateText call (30 seconds). */
const COMPACTION_TIMEOUT_MS = 30_000;

const COMPACTION_PROMPT = `Summarize this conversation as a structured handoff into these sections:

1. **Current State** — what we're working on right now
2. **Original Task** — what the user originally asked for
3. **Key Data** — important values, IDs, file paths, or facts that must be preserved
4. **Actions Taken** — tools called and what they returned (summarized, not verbatim)
5. **Errors & Corrections** — what went wrong and what we tried instead
6. **Next Steps** — what should happen next

Keep each section under 500 tokens. Focus on information the agent needs to continue working. Omit sections that have no content.`;

/**
 * Handle the COMPACTING state.
 *
 * Splits messages into "old" (to be summarized) and "recent" (kept verbatim).
 * Calls generateText with a cheap model to produce a structured summary.
 * Replaces old messages with a single summary message.
 */
export async function handleCompacting(
  state: CompactingState,
  ctx: AgentContext,
): Promise<TransitionResult> {
  const effects: SSEEvent[] = [];
  const {keepRecentTurns, maxSummaryTokens, compactionCircuitBreaker} = ctx.config;

  // Circuit breaker — if we've failed too many times, skip compaction
  if (ctx.compactionFailures >= compactionCircuitBreaker) {
    ctx.logger.warn('compaction_circuit_breaker', {
      session: ctx.sessionId,
      failures: ctx.compactionFailures,
      threshold: compactionCircuitBreaker,
    });
    return {
      next: {type: 'thinking', messages: state.messages},
      effects,
    };
  }

  // Split messages: keep last N turns verbatim, summarize the rest.
  // A "turn" is a user message + assistant response (+ any tool results).
  // We count from the end by counting user messages.
  const splitIndex = findSplitIndex(state.messages, keepRecentTurns);

  if (splitIndex <= 0) {
    // Not enough messages to compact — nothing older than the recent window
    ctx.logger.debug('compaction_skipped_too_few', {
      session: ctx.sessionId,
      messageCount: state.messages.length,
      keepRecentTurns,
    });
    return {
      next: {type: 'thinking', messages: state.messages},
      effects,
    };
  }

  const oldMessages = state.messages.slice(0, splitIndex);
  const recentMessages = state.messages.slice(splitIndex);
  const tokensBefore = state.estimatedTokens;

  effects.push({
    type: SSEEventType.CompactionStart,
    estimated_tokens: tokensBefore,
    threshold: ctx.config.compactThreshold,
    timestamp: new Date().toISOString(),
  });

  ctx.logger.info('compaction_start', {
    session: ctx.sessionId,
    totalMessages: state.messages.length,
    oldMessages: oldMessages.length,
    recentMessages: recentMessages.length,
    tokensBefore,
  });

  const summaryResult = await summarizeMessages(oldMessages, ctx, maxSummaryTokens);

  if (!summaryResult.ok) {
    ctx.compactionFailures++;
    ctx.logger.error('compaction_failed', {
      session: ctx.sessionId,
      error: summaryResult.error.message,
      failure: ctx.compactionFailures,
      circuitBreakerAt: compactionCircuitBreaker,
    });
    // Continue without compaction — the agent can still work, just with
    // a fuller context. Better than crashing the loop.
    return {
      next: {type: 'thinking', messages: state.messages},
      effects,
    };
  }

  // Build the compacted message list: summary + recent turns.
  // Uses 'system' role — this is context injected by the runtime, not user input.
  const summaryMessage: ModelMessage = {
    role: 'system',
    content: `${COMPACTION_SUMMARY_PREFIX}\n\n${summaryResult.value.text}`,
  };
  const compactedMessages = [summaryMessage, ...recentMessages];

  // Update context
  ctx.messages = compactedMessages;
  ctx.compactionFailures = 0; // Reset circuit breaker on success

  const tokensAfter = estimateTokenCount(compactedMessages, ctx.provider);
  const compactionTokens = summaryResult.value.usage.inputTokens + summaryResult.value.usage.outputTokens;

  ctx.logger.info('compaction_end', {
    session: ctx.sessionId,
    tokensBefore,
    tokensAfter,
    messagesBefore: state.messages.length,
    messagesAfter: compactedMessages.length,
  });

  effects.push({
    type: SSEEventType.CompactionEnd,
    tokens_before: tokensBefore,
    tokens_after: tokensAfter,
    compaction_tokens: compactionTokens,
    timestamp: new Date().toISOString(),
  });

  return {
    next: {type: 'thinking', messages: compactedMessages},
    effects,
  };
}

// ---------------------------------------------------------------------------
// Summarization
// ---------------------------------------------------------------------------

interface SummarySuccess {
  text: string;
  usage: {inputTokens: number; outputTokens: number};
}

/**
 * Summarize old messages using generateText.
 * Returns Result to avoid try/catch in the caller.
 */
async function summarizeMessages(
  messages: ModelMessage[],
  ctx: AgentContext,
  maxSummaryTokens: number,
): Promise<Result<SummarySuccess, CompactionError>> {
  // Serialize old messages into a readable conversation format
  const conversationText = messagesToText(messages);

  // Per-call timeout composed with session abort signal — prevents a hung
  // provider from blocking the loop until session-level abort.
  const timeoutSignal = AbortSignal.timeout(COMPACTION_TIMEOUT_MS);
  const combinedSignal = AbortSignal.any([ctx.signal, timeoutSignal]);

  try {
    const result = await ctx.provider.generateText({
      messages: [
        {role: 'user', content: `Here is a conversation to summarize:\n\n${conversationText}`},
      ],
      system: COMPACTION_PROMPT,
      maxOutputTokens: maxSummaryTokens,
      abortSignal: combinedSignal,
    });

    // Track compaction token usage
    ctx.usage.inputTokens += result.usage.inputTokens;
    ctx.usage.outputTokens += result.usage.outputTokens;
    ctx.usage.totalTokens += result.usage.inputTokens + result.usage.outputTokens;

    if (!result.text || result.text.trim().length === 0) {
      return {
        ok: false,
        error: new CompactionError('Summarization returned empty text', {
          stage: 'summarize',
          context: {messageCount: messages.length},
        }),
      };
    }

    return {
      ok: true,
      value: {
        text: result.text,
        usage: {inputTokens: result.usage.inputTokens, outputTokens: result.usage.outputTokens},
      },
    };
  } catch (err) {
    // Specific expected failure with specific handling (reason #3):
    // Provider errors during compaction are non-fatal — the caller degrades
    // gracefully by continuing without compaction.
    return {
      ok: false,
      error: new CompactionError(
        `Summarization failed: ${err instanceof Error ? err.message : String(err)}`,
        {stage: 'summarize', cause: err, context: {messageCount: messages.length}},
      ),
    };
  }
}

/**
 * Convert messages to a readable text format for the summarizer.
 */
function messagesToText(messages: ModelMessage[]): string {
  const lines: string[] = [];

  for (const msg of messages) {
    const role = msg.role.toUpperCase();

    if (typeof msg.content === 'string') {
      lines.push(`${role}: ${msg.content}`);
      continue;
    }

    if (!Array.isArray(msg.content)) continue;

    for (const part of msg.content) {
      if (!('type' in part)) continue;

      if (part.type === 'text' && 'text' in part) {
        lines.push(`${role}: ${part.text}`);
      } else if (part.type === 'tool-call' && 'toolName' in part) {
        const args = 'input' in part ? JSON.stringify(part.input) : '{}';
        lines.push(`${role} [tool_call: ${part.toolName}(${args})]`);
      } else if (part.type === 'tool-result' && 'output' in part) {
        const output = extractToolResultText(part.output);
        // Truncate long tool results for the summarizer — it doesn't need 20K
        const truncated = output.length > 2_000
          ? output.slice(0, 2_000) + '... [truncated for summarization]'
          : output;
        lines.push(`TOOL_RESULT: ${truncated}`);
      }
    }
  }

  return lines.join('\n');
}

/**
 * Extract text from a tool result output field.
 */
function extractToolResultText(output: unknown): string {
  if (typeof output === 'string') return output;
  if (typeof output === 'object' && output !== null && 'value' in output) {
    // `in` narrows to `object & Record<'value', unknown>` — safe to access
    return String(output.value);
  }
  return JSON.stringify(output);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Find the index to split messages: everything before this index gets
 * summarized, everything at or after is kept verbatim.
 *
 * Counts user messages from the end to find `keepTurns` turn boundaries.
 */
function findSplitIndex(messages: ModelMessage[], keepTurns: number): number {
  let userMessagesSeen = 0;

  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === 'user') {
      userMessagesSeen++;
      if (userMessagesSeen >= keepTurns) {
        return i;
      }
    }
  }

  // Not enough turns to split — return 0 (don't compact)
  return 0;
}
