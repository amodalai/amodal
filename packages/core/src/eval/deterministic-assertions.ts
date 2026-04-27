/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

/**
 * Deterministic (non-LLM) assertion evaluator.
 *
 * Assertions that match a `key: value` pattern with a known key are
 * evaluated programmatically. Unknown keys or parse errors return `null`,
 * signaling the caller to fall through to the LLM judge.
 */

import {judgeAllAssertions} from './eval-judge.js';
import type {JudgeProvider} from './eval-judge.js';
import type {AssertionResult} from './eval-types.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const DETERMINISTIC_KEYS = {
  CONTAINS: 'contains',
  REGEX: 'regex',
  STARTS_WITH: 'starts_with',
  LENGTH_BETWEEN: 'length_between',
  TOOL_CALLED: 'tool_called',
  TOOL_NOT_CALLED: 'tool_not_called',
  MAX_LATENCY: 'max_latency',
  MAX_TURNS: 'max_turns',
} as const;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DeterministicContext {
  response: string;
  toolCalls: Array<{name: string; parameters: Record<string, unknown>}>;
  durationMs: number;
  turns: number;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Try to evaluate an assertion deterministically without an LLM judge.
 * Returns the result if the assertion matches a known `key: value` pattern,
 * or `null` if it should fall through to the LLM judge.
 */
export function tryDeterministicAssertion(
  assertionText: string,
  negated: boolean,
  ctx: DeterministicContext,
): {passed: boolean; reason: string} | null {
  const match = assertionText.match(/^(\w+):\s*(.+)$/);
  if (!match) return null;

  const [, key, rawValue] = match;
  const value = rawValue.trim();

  switch (key) {
    case DETERMINISTIC_KEYS.CONTAINS: {
      const found = ctx.response.includes(value);
      const passed = negated ? !found : found;
      return {passed, reason: found ? `Response contains "${value}"` : `Response does not contain "${value}"`};
    }
    case DETERMINISTIC_KEYS.REGEX: {
      try {
        const re = new RegExp(value);
        const found = re.test(ctx.response);
        const passed = negated ? !found : found;
        return {passed, reason: found ? `Response matches pattern ${value}` : `Response does not match pattern ${value}`};
      } catch {
        // Invalid regex — fall through to LLM judge
        return null;
      }
    }
    case DETERMINISTIC_KEYS.STARTS_WITH: {
      const found = ctx.response.startsWith(value);
      const passed = negated ? !found : found;
      return {passed, reason: found ? `Response starts with "${value}"` : `Response does not start with "${value}"`};
    }
    case DETERMINISTIC_KEYS.LENGTH_BETWEEN: {
      try {
        const parsed: unknown = JSON.parse(value);
        if (!Array.isArray(parsed) || parsed.length !== 2) return null;
        const min = Number(parsed[0]);
        const max = Number(parsed[1]);
        const len = ctx.response.length;
        const inRange = len >= min && len <= max;
        const passed = negated ? !inRange : inRange;
        return {passed, reason: `Response length is ${len} (range: ${min}-${max})`};
      } catch {
        return null;
      }
    }
    case DETERMINISTIC_KEYS.TOOL_CALLED: {
      const found = ctx.toolCalls.some(tc => tc.name === value);
      const passed = negated ? !found : found;
      return {passed, reason: found ? `Tool "${value}" was called` : `Tool "${value}" was not called`};
    }
    case DETERMINISTIC_KEYS.TOOL_NOT_CALLED: {
      const found = ctx.toolCalls.some(tc => tc.name === value);
      const passed = negated ? found : !found;
      return {passed, reason: found ? `Tool "${value}" was called` : `Tool "${value}" was not called`};
    }
    case DETERMINISTIC_KEYS.MAX_LATENCY: {
      const maxMs = Number(value);
      if (Number.isNaN(maxMs)) return null;
      const passed = negated ? ctx.durationMs > maxMs : ctx.durationMs <= maxMs;
      return {passed, reason: `Duration: ${ctx.durationMs}ms (max: ${maxMs}ms)`};
    }
    case DETERMINISTIC_KEYS.MAX_TURNS: {
      const maxTurns = Number(value);
      if (Number.isNaN(maxTurns)) return null;
      const passed = negated ? ctx.turns > maxTurns : ctx.turns <= maxTurns;
      return {passed, reason: `Turns: ${ctx.turns} (max: ${maxTurns})`};
    }
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Shared evaluation pipeline
// ---------------------------------------------------------------------------

/**
 * Evaluate assertions using deterministic checks first, falling through
 * to the LLM judge for any that can't be resolved programmatically.
 *
 * This consolidates the split-try-merge pattern that was duplicated in
 * both the core eval-runner and the runtime evals route.
 */
export async function evaluateAssertions(
  enrichedResponse: string,
  assertions: Array<{text: string; negated: boolean}>,
  deterministicCtx: DeterministicContext,
  judgeProvider: JudgeProvider,
): Promise<AssertionResult[]> {
  // Try deterministic assertions first
  const assertionSlots: Array<{text: string; negated: boolean; result: AssertionResult | null}> = assertions.map((a) => {
    const det = tryDeterministicAssertion(a.text, a.negated, deterministicCtx);
    return {
      text: a.text,
      negated: a.negated,
      result: det ? {text: a.text, negated: a.negated, passed: det.passed, reason: det.reason} : null,
    };
  });

  // Collect assertions that need LLM judging
  const needsJudging = assertions.filter((_, i) => assertionSlots[i].result === null);
  const judgedResults = needsJudging.length > 0
    ? await judgeAllAssertions(enrichedResponse, needsJudging, judgeProvider)
    : [];

  // Merge results back in order
  let judgeIdx = 0;
  return assertionSlots.map((slot) => {
    if (slot.result !== null) return slot.result;
    return judgedResults[judgeIdx++];
  });
}
