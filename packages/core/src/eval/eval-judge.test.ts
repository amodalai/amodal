/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import {describe, it, expect, vi} from 'vitest';
import {judgeAssertion, judgeAllAssertions} from './eval-judge.js';
import type {JudgeProvider} from './eval-judge.js';

function makeProvider(response: string): JudgeProvider {
  return {judge: vi.fn().mockResolvedValue(response)};
}

describe('judgeAssertion', () => {
  it('returns passed=true for PASS response', async () => {
    const provider = makeProvider('PASS: Response mentions the user');
    const result = await judgeAssertion(
      'Hello user',
      {text: 'mention the user', negated: false},
      provider,
    );
    expect(result.passed).toBe(true);
    expect(result.reason).toBe('Response mentions the user');
  });

  it('returns passed=false for FAIL response', async () => {
    const provider = makeProvider('FAIL: No mention of pricing');
    const result = await judgeAssertion(
      'Hello world',
      {text: 'include pricing info', negated: false},
      provider,
    );
    expect(result.passed).toBe(false);
    expect(result.reason).toBe('No mention of pricing');
  });

  it('handles negated assertions', async () => {
    const provider = makeProvider('PASS: Response does not leak secrets');
    const result = await judgeAssertion(
      'Public info only',
      {text: 'leak secrets', negated: true},
      provider,
    );
    expect(result.passed).toBe(true);
    expect(result.negated).toBe(true);
  });

  it('returns failure for unparseable response', async () => {
    const provider = makeProvider('I think it passes');
    const result = await judgeAssertion(
      'Some response',
      {text: 'be clear', negated: false},
      provider,
    );
    expect(result.passed).toBe(false);
    expect(result.reason).toContain('unparseable');
  });

  it('handles provider errors gracefully', async () => {
    const provider: JudgeProvider = {
      judge: vi.fn().mockRejectedValue(new Error('API down')),
    };
    const result = await judgeAssertion(
      'response',
      {text: 'work', negated: false},
      provider,
    );
    expect(result.passed).toBe(false);
    expect(result.reason).toContain('API down');
  });

  it('is case-insensitive on PASS/FAIL prefix', async () => {
    const provider = makeProvider('pass: looks good');
    const result = await judgeAssertion(
      'response',
      {text: 'be good', negated: false},
      provider,
    );
    expect(result.passed).toBe(true);
  });
});

describe('judgeAllAssertions', () => {
  it('judges multiple assertions sequentially', async () => {
    const provider: JudgeProvider = {
      judge: vi.fn()
        .mockResolvedValueOnce('PASS: yes')
        .mockResolvedValueOnce('FAIL: no'),
    };

    const results = await judgeAllAssertions(
      'response',
      [
        {text: 'include greeting', negated: false},
        {text: 'include pricing', negated: false},
      ],
      provider,
    );

    expect(results).toHaveLength(2);
    expect(results[0].passed).toBe(true);
    expect(results[1].passed).toBe(false);
  });
});
