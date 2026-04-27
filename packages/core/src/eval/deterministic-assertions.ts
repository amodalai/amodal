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
    case 'contains': {
      const found = ctx.response.includes(value);
      const passed = negated ? !found : found;
      return {passed, reason: found ? `Response contains "${value}"` : `Response does not contain "${value}"`};
    }
    case 'regex': {
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
    case 'starts_with': {
      const found = ctx.response.startsWith(value);
      const passed = negated ? !found : found;
      return {passed, reason: found ? `Response starts with "${value}"` : `Response does not start with "${value}"`};
    }
    case 'length_between': {
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
    case 'tool_called': {
      const found = ctx.toolCalls.some(tc => tc.name === value);
      const passed = negated ? !found : found;
      return {passed, reason: found ? `Tool "${value}" was called` : `Tool "${value}" was not called`};
    }
    case 'tool_not_called': {
      const found = ctx.toolCalls.some(tc => tc.name === value);
      const passed = negated ? found : !found;
      return {passed, reason: found ? `Tool "${value}" was called` : `Tool "${value}" was not called`};
    }
    case 'max_latency': {
      const maxMs = Number(value);
      if (Number.isNaN(maxMs)) return null;
      const passed = negated ? ctx.durationMs > maxMs : ctx.durationMs <= maxMs;
      return {passed, reason: `Duration: ${ctx.durationMs}ms (max: ${maxMs}ms)`};
    }
    case 'max_turns': {
      const maxTurns = Number(value);
      if (Number.isNaN(maxTurns)) return null;
      const passed = negated ? ctx.turns > maxTurns : ctx.turns <= maxTurns;
      return {passed, reason: `Turns: ${ctx.turns} (max: ${maxTurns})`};
    }
    default:
      return null;
  }
}
