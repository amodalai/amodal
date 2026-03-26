/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import {describe, it, expect} from 'vitest';
import type {
  LLMStreamEvent,
  LLMStreamTextDelta,
  LLMStreamToolUseStart,
  LLMStreamToolUseDelta,
  LLMStreamToolUseEnd,
  LLMStreamMessageEnd,
} from './streaming-types.js';

describe('streaming-types', () => {
  it('should allow constructing a text_delta event', () => {
    const event: LLMStreamTextDelta = {type: 'text_delta', text: 'Hello'};
    expect(event.type).toBe('text_delta');
    expect(event.text).toBe('Hello');
  });

  it('should allow constructing a tool_use_start event', () => {
    const event: LLMStreamToolUseStart = {type: 'tool_use_start', id: 'tc-1', name: 'request'};
    expect(event.type).toBe('tool_use_start');
    expect(event.id).toBe('tc-1');
  });

  it('should allow constructing a tool_use_delta event', () => {
    const event: LLMStreamToolUseDelta = {type: 'tool_use_delta', id: 'tc-1', inputDelta: '{"url":'};
    expect(event.type).toBe('tool_use_delta');
    expect(event.inputDelta).toBe('{"url":');
  });

  it('should allow constructing a tool_use_end event', () => {
    const event: LLMStreamToolUseEnd = {type: 'tool_use_end', id: 'tc-1', input: {url: '/api'}};
    expect(event.type).toBe('tool_use_end');
    expect(event.input).toEqual({url: '/api'});
  });

  it('should allow constructing a message_end event', () => {
    const event: LLMStreamMessageEnd = {
      type: 'message_end',
      stopReason: 'end_turn',
      usage: {inputTokens: 10, outputTokens: 5},
    };
    expect(event.type).toBe('message_end');
    expect(event.stopReason).toBe('end_turn');
  });

  it('should work as discriminated union', () => {
    const events: LLMStreamEvent[] = [
      {type: 'text_delta', text: 'Hello'},
      {type: 'tool_use_start', id: 'tc-1', name: 'request'},
      {type: 'tool_use_delta', id: 'tc-1', inputDelta: '{}'},
      {type: 'tool_use_end', id: 'tc-1', input: {}},
      {type: 'message_end', stopReason: 'tool_use'},
    ];

    expect(events).toHaveLength(5);
    expect(events[0]?.type).toBe('text_delta');
    expect(events[4]?.type).toBe('message_end');
  });
});
