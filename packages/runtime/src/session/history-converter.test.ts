/**
 * @license
 * Copyright 2025 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import { describe, it, expect } from 'vitest';
import { convertSessionMessagesToHistory } from './history-converter.js';
import type { SessionMessage } from './session-manager.js';

function makeMsg(
  overrides: Partial<SessionMessage> & { type: SessionMessage['type']; text: string },
): SessionMessage {
  return {
    id: `msg-${Math.random().toString(36).slice(2)}`,
    timestamp: new Date().toISOString(),
    ...overrides,
  };
}

describe('convertSessionMessagesToHistory', () => {
  it('converts user and assistant messages to Content[]', () => {
    const messages: SessionMessage[] = [
      makeMsg({ type: 'user', text: 'Hello' }),
      makeMsg({ type: 'assistant_text', text: 'Hi there!' }),
      makeMsg({ type: 'user', text: 'How are you?' }),
      makeMsg({ type: 'assistant_text', text: 'I am well.' }),
    ];

    const history = convertSessionMessagesToHistory(messages);
    expect(history).toHaveLength(4);
    expect(history[0]).toEqual({ role: 'user', parts: [{ text: 'Hello' }] });
    expect(history[1]).toEqual({ role: 'model', parts: [{ text: 'Hi there!' }] });
    expect(history[2]).toEqual({ role: 'user', parts: [{ text: 'How are you?' }] });
    expect(history[3]).toEqual({ role: 'model', parts: [{ text: 'I am well.' }] });
  });

  it('skips error messages', () => {
    const messages: SessionMessage[] = [
      makeMsg({ type: 'user', text: 'Hello' }),
      makeMsg({ type: 'error', text: 'Something went wrong' }),
      makeMsg({ type: 'assistant_text', text: 'Hi!' }),
    ];

    const history = convertSessionMessagesToHistory(messages);
    expect(history).toHaveLength(2);
    expect(history[0]?.role).toBe('user');
    expect(history[1]?.role).toBe('model');
  });

  it('skips empty text messages', () => {
    const messages: SessionMessage[] = [
      makeMsg({ type: 'user', text: 'Hello' }),
      makeMsg({ type: 'assistant_text', text: '' }),
      makeMsg({ type: 'assistant_text', text: '   ' }),
      makeMsg({ type: 'assistant_text', text: 'Real response' }),
    ];

    const history = convertSessionMessagesToHistory(messages);
    expect(history).toHaveLength(2);
    expect(history[1]?.parts?.[0]?.text).toBe('Real response');
  });

  it('merges adjacent same-role entries', () => {
    const messages: SessionMessage[] = [
      makeMsg({ type: 'user', text: 'Part 1' }),
      makeMsg({ type: 'user', text: 'Part 2' }),
      makeMsg({ type: 'assistant_text', text: 'Response' }),
    ];

    const history = convertSessionMessagesToHistory(messages);
    expect(history).toHaveLength(2);
    expect(history[0]?.parts?.[0]?.text).toBe('Part 1\n\nPart 2');
    expect(history[1]?.parts?.[0]?.text).toBe('Response');
  });

  it('merges after filtering errors leaves adjacent same-role', () => {
    const messages: SessionMessage[] = [
      makeMsg({ type: 'user', text: 'Hello' }),
      makeMsg({ type: 'assistant_text', text: 'Part A' }),
      makeMsg({ type: 'error', text: 'oops' }),
      makeMsg({ type: 'assistant_text', text: 'Part B' }),
      makeMsg({ type: 'user', text: 'Next' }),
    ];

    const history = convertSessionMessagesToHistory(messages);
    expect(history).toHaveLength(3);
    expect(history[0]?.role).toBe('user');
    expect(history[1]?.role).toBe('model');
    expect(history[1]?.parts?.[0]?.text).toBe('Part A\n\nPart B');
    expect(history[2]?.role).toBe('user');
  });

  it('ensures history starts with user role', () => {
    const messages: SessionMessage[] = [
      makeMsg({ type: 'assistant_text', text: 'I start first' }),
      makeMsg({ type: 'user', text: 'Hello' }),
      makeMsg({ type: 'assistant_text', text: 'Hi!' }),
    ];

    const history = convertSessionMessagesToHistory(messages);
    expect(history).toHaveLength(2);
    expect(history[0]?.role).toBe('user');
    expect(history[0]?.parts?.[0]?.text).toBe('Hello');
  });

  it('returns empty array for empty input', () => {
    expect(convertSessionMessagesToHistory([])).toEqual([]);
  });

  it('returns empty array when all messages are errors', () => {
    const messages: SessionMessage[] = [
      makeMsg({ type: 'error', text: 'fail 1' }),
      makeMsg({ type: 'error', text: 'fail 2' }),
    ];
    expect(convertSessionMessagesToHistory(messages)).toEqual([]);
  });

  it('handles single user message', () => {
    const messages: SessionMessage[] = [
      makeMsg({ type: 'user', text: 'Solo' }),
    ];

    const history = convertSessionMessagesToHistory(messages);
    expect(history).toHaveLength(1);
    expect(history[0]).toEqual({ role: 'user', parts: [{ text: 'Solo' }] });
  });

  it('handles single assistant message (dropped — must start with user)', () => {
    const messages: SessionMessage[] = [
      makeMsg({ type: 'assistant_text', text: 'Orphan response' }),
    ];

    const history = convertSessionMessagesToHistory(messages);
    expect(history).toEqual([]);
  });

  it('ensures alternating roles after start-trim exposes adjacency', () => {
    // After removing the leading model messages, two user messages become adjacent
    const messages: SessionMessage[] = [
      makeMsg({ type: 'assistant_text', text: 'pre-1' }),
      makeMsg({ type: 'assistant_text', text: 'pre-2' }),
      makeMsg({ type: 'user', text: 'Hello' }),
      makeMsg({ type: 'user', text: 'World' }),
      makeMsg({ type: 'assistant_text', text: 'Response' }),
    ];

    const history = convertSessionMessagesToHistory(messages);
    expect(history).toHaveLength(2);
    expect(history[0]?.role).toBe('user');
    expect(history[0]?.parts?.[0]?.text).toBe('Hello\n\nWorld');
    expect(history[1]?.role).toBe('model');
  });
});
