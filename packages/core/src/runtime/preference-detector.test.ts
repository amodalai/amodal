/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import {describe, it, expect, vi} from 'vitest';
import {detectPreferences} from './preference-detector.js';
import type {JudgeProvider} from '../eval/eval-judge.js';

describe('detectPreferences', () => {
  it('returns empty for short conversations', async () => {
    const provider: JudgeProvider = {judge: vi.fn()};
    const result = await detectPreferences(
      [{role: 'user', content: 'Hello'}],
      provider,
    );
    expect(result).toEqual([]);
  });

  it('detects corrections with LLM extraction', async () => {
    const provider: JudgeProvider = {
      judge: vi.fn().mockResolvedValue('PREF: category=style preference=Use shorter responses source=correction'),
    };

    const result = await detectPreferences(
      [
        {role: 'user', content: 'What is X?'},
        {role: 'assistant', content: 'X is a very long explanation...'},
        {role: 'user', content: 'No, make it shorter please'},
      ],
      provider,
    );

    expect(result).toHaveLength(1);
    expect(result[0].category).toBe('style');
    expect(result[0].preference).toBe('Use shorter responses');
    expect(result[0].source).toBe('correction');
  });

  it('detects explicit preferences', async () => {
    const provider: JudgeProvider = {
      judge: vi.fn().mockResolvedValue('PREF: category=content preference=Always include examples source=explicit'),
    };

    const result = await detectPreferences(
      [
        {role: 'user', content: 'Hello'},
        {role: 'assistant', content: 'Hi there!'},
        {role: 'user', content: 'I prefer responses with code examples'},
      ],
      provider,
    );

    expect(result).toHaveLength(1);
    expect(result[0].source).toBe('explicit');
  });

  it('skips messages without correction patterns', async () => {
    const provider: JudgeProvider = {judge: vi.fn()};

    const result = await detectPreferences(
      [
        {role: 'user', content: 'Tell me about JavaScript'},
        {role: 'assistant', content: 'JavaScript is...'},
        {role: 'user', content: 'Thanks, that was helpful'},
      ],
      provider,
    );

    expect(result).toEqual([]);
    expect(provider.judge).not.toHaveBeenCalled();
  });

  it('handles LLM returning NONE', async () => {
    const provider: JudgeProvider = {
      judge: vi.fn().mockResolvedValue('NONE: no clear preference detected'),
    };

    const result = await detectPreferences(
      [
        {role: 'user', content: 'Hello'},
        {role: 'assistant', content: 'Hi!'},
        {role: 'user', content: "Actually let's talk about something else"},
      ],
      provider,
    );

    expect(result).toEqual([]);
  });

  it('handles LLM errors gracefully', async () => {
    const provider: JudgeProvider = {
      judge: vi.fn().mockRejectedValue(new Error('API down')),
    };

    const result = await detectPreferences(
      [
        {role: 'user', content: 'Hello'},
        {role: 'assistant', content: 'Hi!'},
        {role: 'user', content: "No, don't say hi like that"},
      ],
      provider,
    );

    expect(result).toEqual([]);
  });

  it('rejects invalid categories', async () => {
    const provider: JudgeProvider = {
      judge: vi.fn().mockResolvedValue('PREF: category=invalid preference=something source=correction'),
    };

    const result = await detectPreferences(
      [
        {role: 'user', content: 'Hello'},
        {role: 'assistant', content: 'Hi!'},
        {role: 'user', content: "Actually I prefer something else"},
      ],
      provider,
    );

    expect(result).toEqual([]);
  });
});
