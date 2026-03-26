/**
 * @license
 * Copyright 2025 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import {describe, it, expect} from 'vitest';
import {convertSessionMessages} from './useSessionResume.js';
import type {SessionMessage} from './types.js';

describe('convertSessionMessages', () => {
  it('converts user messages', () => {
    const input: SessionMessage[] = [
      {role: 'user', text: 'hello'},
    ];
    const result = convertSessionMessages(input);
    expect(result).toHaveLength(1);
    expect(result[0]?.role).toBe('user');
    expect(result[0]?.text).toBe('hello');
    expect(result[0]?.id).toMatch(/^resume-/);
  });

  it('converts assistant messages with tool calls', () => {
    const input: SessionMessage[] = [
      {
        role: 'assistant',
        text: 'Found the data',
        tool_calls: [
          {
            tool_name: 'request',
            tool_id: 't1',
            args: {url: '/api/data'},
            status: 'success',
            result: '{"ok": true}',
            duration_ms: 120,
          },
        ],
        skills: ['triage'],
        thinking: 'Analyzing the query',
      },
    ];
    const result = convertSessionMessages(input);
    expect(result).toHaveLength(1);
    expect(result[0]?.toolCalls).toHaveLength(1);
    expect(result[0]?.toolCalls?.[0]?.toolName).toBe('request');
    expect(result[0]?.toolCalls?.[0]?.durationMs).toBe(120);
    expect(result[0]?.skills).toContain('triage');
    expect(result[0]?.thinking).toBe('Analyzing the query');
  });

  it('handles messages without optional fields', () => {
    const input: SessionMessage[] = [
      {role: 'assistant', text: 'Simple response'},
    ];
    const result = convertSessionMessages(input);
    expect(result[0]?.toolCalls).toBeUndefined();
    expect(result[0]?.skills).toBeUndefined();
    expect(result[0]?.thinking).toBeUndefined();
  });

  it('converts a full conversation', () => {
    const input: SessionMessage[] = [
      {role: 'user', text: 'What is the error rate?'},
      {role: 'assistant', text: 'The error rate is 2.3%'},
      {role: 'user', text: 'Why?'},
      {role: 'assistant', text: 'Due to timeout issues'},
    ];
    const result = convertSessionMessages(input);
    expect(result).toHaveLength(4);
    expect(result[0]?.role).toBe('user');
    expect(result[1]?.role).toBe('assistant');
    expect(result[2]?.role).toBe('user');
    expect(result[3]?.role).toBe('assistant');
  });

  it('handles empty array', () => {
    const result = convertSessionMessages([]);
    expect(result).toHaveLength(0);
  });
});
