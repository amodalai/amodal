/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

/**
 * Trajectory-assertion helpers for smoke/e2e tests.
 *
 * These wrap the common "filter SSE events and look at them" patterns
 * scattered across our test files. They form the same vocabulary a
 * future eval `trajectory` scorer would use — write them once here,
 * move the abstractions into the eval framework when scorers ship.
 *
 * Event objects are loosely typed as `Record<string, unknown>` because
 * smoke tests parse SSE JSON without a hard schema binding.
 */

import {expect} from 'vitest';

type EventRecord = Record<string, unknown>;

// ---------------------------------------------------------------------------
// Event extraction
// ---------------------------------------------------------------------------

/** Find the first event matching `type`, or undefined. */
export function findEvent(events: EventRecord[], type: string): EventRecord | undefined {
  return events.find((e) => e['type'] === type);
}

/** Find all events matching `type`. */
export function findEvents(events: EventRecord[], type: string): EventRecord[] {
  return events.filter((e) => e['type'] === type);
}

/** Concatenate text_delta event contents into the final assistant response. */
export function collectText(events: EventRecord[]): string {
  return findEvents(events, 'text_delta')
    .map((e) => String(e['content'] ?? ''))
    .join('');
}

// ---------------------------------------------------------------------------
// Assertions
// ---------------------------------------------------------------------------

/** Assert that a tool was called by name. Optionally match parameters. */
export function expectToolCalled(
  events: EventRecord[],
  toolName: string,
  opts?: {argsInclude?: Record<string, unknown>},
): void {
  const starts = findEvents(events, 'tool_call_start').filter(
    (e) => e['tool_name'] === toolName,
  );
  expect(starts.length, `expected tool "${toolName}" to have been called`).toBeGreaterThan(0);

  if (opts?.argsInclude) {
    const expected = opts.argsInclude;
    const match = starts.find((e) => paramsInclude(e['parameters'], expected));
    expect(
      match,
      `expected tool "${toolName}" to be called with args including ${JSON.stringify(expected)}`,
    ).toBeDefined();
  }
}

/** Assert that a tool was NOT called by name. */
export function expectToolNotCalled(events: EventRecord[], toolName: string): void {
  const starts = findEvents(events, 'tool_call_start').filter(
    (e) => e['tool_name'] === toolName,
  );
  expect(starts.length, `expected tool "${toolName}" to NOT have been called`).toBe(0);
}

/** Assert the `done` event carries the expected termination reason. */
export function expectDoneReason(
  events: EventRecord[],
  reason:
    | 'model_stop'
    | 'max_turns'
    | 'user_abort'
    | 'error'
    | 'budget_exceeded'
    | 'loop_detected',
): void {
  const done = findEvent(events, 'done');
  expect(done, 'expected a done event').toBeDefined();
  expect(done?.['reason']).toBe(reason);
}

/** Assert event types appear in order (not necessarily contiguous). */
export function expectEventSequence(events: EventRecord[], sequence: string[]): void {
  const types = events.map((e) => String(e['type']));
  let searchFrom = 0;
  for (const expected of sequence) {
    const idx = types.indexOf(expected, searchFrom);
    expect(
      idx,
      `expected event "${expected}" after position ${searchFrom} in: ${types.slice(searchFrom).join(', ')}`,
    ).toBeGreaterThanOrEqual(0);
    searchFrom = idx + 1;
  }
}

/** Assert no events of these types were emitted. */
export function expectNoEventsOf(events: EventRecord[], ...types: string[]): void {
  for (const type of types) {
    const hits = findEvents(events, type);
    expect(hits.length, `expected no "${type}" events, got ${hits.length}`).toBe(0);
  }
}

/** Assert total_tokens on the done event is within a range. */
export function expectTotalTokens(
  events: EventRecord[],
  predicate: {atLeast?: number; atMost?: number},
): void {
  const done = findEvent(events, 'done');
  expect(done, 'expected a done event').toBeDefined();
  const usage = done?.['usage'];
  const total = isRecord(usage) && typeof usage['total_tokens'] === 'number'
    ? usage['total_tokens']
    : 0;
  if (predicate.atLeast !== undefined) {
    expect(total, `total_tokens ${total} should be >= ${predicate.atLeast}`).toBeGreaterThanOrEqual(predicate.atLeast);
  }
  if (predicate.atMost !== undefined) {
    expect(total, `total_tokens ${total} should be <= ${predicate.atMost}`).toBeLessThanOrEqual(predicate.atMost);
  }
}

// ---------------------------------------------------------------------------
// Internal
// ---------------------------------------------------------------------------

/**
 * Recursive deep-include: every key in `subset` must exist in `obj` with
 * a matching value (primitive equality or nested deep-include). Accepts
 * `unknown` for both inputs and type-guards at each level.
 */
function paramsInclude(obj: unknown, subset: Record<string, unknown>): boolean {
  if (!isRecord(obj)) return false;
  for (const [key, expected] of Object.entries(subset)) {
    const actual = obj[key];
    if (isRecord(expected)) {
      if (!isRecord(actual)) return false;
      if (!paramsInclude(actual, expected)) return false;
    } else if (actual !== expected) {
      return false;
    }
  }
  return true;
}

/** Type guard: narrows `unknown` to a plain object record. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
