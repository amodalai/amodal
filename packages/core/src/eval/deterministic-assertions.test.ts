/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import {describe, it, expect} from 'vitest';
import {tryDeterministicAssertion} from './deterministic-assertions.js';
import type {DeterministicContext} from './deterministic-assertions.js';

function makeCtx(overrides: Partial<DeterministicContext> = {}): DeterministicContext {
  return {
    response: 'Hello world, here are 3 results.',
    toolCalls: [{name: 'request', parameters: {url: 'https://example.com'}}],
    durationMs: 5000,
    turns: 2,
    ...overrides,
  };
}

describe('tryDeterministicAssertion', () => {
  describe('returns null for non-deterministic assertions', () => {
    it('returns null for plain text assertion', () => {
      expect(tryDeterministicAssertion('Should return at least 2 titles', false, makeCtx())).toBeNull();
    });

    it('returns null for unknown key', () => {
      expect(tryDeterministicAssertion('foo_bar: something', false, makeCtx())).toBeNull();
    });
  });

  describe('contains', () => {
    it('passes when response contains the value', () => {
      const result = tryDeterministicAssertion('contains: Hello world', false, makeCtx());
      expect(result).not.toBeNull();
      expect(result!.passed).toBe(true);
    });

    it('fails when response does not contain the value', () => {
      const result = tryDeterministicAssertion('contains: goodbye', false, makeCtx());
      expect(result!.passed).toBe(false);
    });

    it('respects negation', () => {
      const result = tryDeterministicAssertion('contains: Hello world', true, makeCtx());
      expect(result!.passed).toBe(false);
    });
  });

  describe('regex', () => {
    it('passes when response matches pattern', () => {
      const result = tryDeterministicAssertion('regex: \\d+ results', false, makeCtx());
      expect(result!.passed).toBe(true);
    });

    it('fails when response does not match', () => {
      const result = tryDeterministicAssertion('regex: ^Goodbye', false, makeCtx());
      expect(result!.passed).toBe(false);
    });

    it('returns null for invalid regex', () => {
      const result = tryDeterministicAssertion('regex: [invalid(', false, makeCtx());
      expect(result).toBeNull();
    });
  });

  describe('starts_with', () => {
    it('passes when response starts with value', () => {
      const result = tryDeterministicAssertion('starts_with: Hello', false, makeCtx());
      expect(result!.passed).toBe(true);
    });

    it('fails when response does not start with value', () => {
      const result = tryDeterministicAssertion('starts_with: world', false, makeCtx());
      expect(result!.passed).toBe(false);
    });
  });

  describe('length_between', () => {
    it('passes when length is in range', () => {
      const result = tryDeterministicAssertion('length_between: [1, 100]', false, makeCtx());
      expect(result!.passed).toBe(true);
    });

    it('fails when length is out of range', () => {
      const result = tryDeterministicAssertion('length_between: [1000, 5000]', false, makeCtx());
      expect(result!.passed).toBe(false);
    });

    it('returns null for invalid JSON', () => {
      const result = tryDeterministicAssertion('length_between: not json', false, makeCtx());
      expect(result).toBeNull();
    });

    it('returns null for wrong array shape', () => {
      const result = tryDeterministicAssertion('length_between: [100]', false, makeCtx());
      expect(result).toBeNull();
    });
  });

  describe('tool_called', () => {
    it('passes when tool was called', () => {
      const result = tryDeterministicAssertion('tool_called: request', false, makeCtx());
      expect(result!.passed).toBe(true);
    });

    it('fails when tool was not called', () => {
      const result = tryDeterministicAssertion('tool_called: search', false, makeCtx());
      expect(result!.passed).toBe(false);
    });
  });

  describe('tool_not_called', () => {
    it('passes when tool was not called', () => {
      const result = tryDeterministicAssertion('tool_not_called: search', false, makeCtx());
      expect(result!.passed).toBe(true);
    });

    it('fails when tool was called', () => {
      const result = tryDeterministicAssertion('tool_not_called: request', false, makeCtx());
      expect(result!.passed).toBe(false);
    });
  });

  describe('max_latency', () => {
    it('passes when under limit', () => {
      const result = tryDeterministicAssertion('max_latency: 10000', false, makeCtx());
      expect(result!.passed).toBe(true);
    });

    it('fails when over limit', () => {
      const result = tryDeterministicAssertion('max_latency: 1000', false, makeCtx());
      expect(result!.passed).toBe(false);
    });

    it('returns null for non-numeric value', () => {
      const result = tryDeterministicAssertion('max_latency: fast', false, makeCtx());
      expect(result).toBeNull();
    });
  });

  describe('max_turns', () => {
    it('passes when under limit', () => {
      const result = tryDeterministicAssertion('max_turns: 5', false, makeCtx());
      expect(result!.passed).toBe(true);
    });

    it('fails when over limit', () => {
      const result = tryDeterministicAssertion('max_turns: 1', false, makeCtx());
      expect(result!.passed).toBe(false);
    });

    it('respects negation', () => {
      const result = tryDeterministicAssertion('max_turns: 1', true, makeCtx());
      expect(result!.passed).toBe(true);
    });
  });
});
