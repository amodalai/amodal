/**
 * @license
 * Copyright 2025 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import { describe, it, expect } from 'vitest';
import {
  ChatRequestSchema,
  WebhookPayloadSchema,
  SSEEventType,
} from './types.js';

describe('ChatRequestSchema', () => {
  it('parses valid request with message only', () => {
    const result = ChatRequestSchema.safeParse({ message: 'hello' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.message).toBe('hello');
      expect(result.data.session_id).toBeUndefined();
    }
  });

  it('parses valid request with all fields', () => {
    const result = ChatRequestSchema.safeParse({
      message: 'hello',
      session_id: 'sess-123',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.session_id).toBe('sess-123');
    }
  });

  it('rejects empty message', () => {
    const result = ChatRequestSchema.safeParse({ message: '' });
    expect(result.success).toBe(false);
  });

  it('rejects missing message', () => {
    const result = ChatRequestSchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it('rejects non-string message', () => {
    const result = ChatRequestSchema.safeParse({ message: 123 });
    expect(result.success).toBe(false);
  });
});

describe('WebhookPayloadSchema', () => {
  it('parses empty object', () => {
    const result = WebhookPayloadSchema.safeParse({});
    expect(result.success).toBe(true);
  });

  it('parses with data', () => {
    const result = WebhookPayloadSchema.safeParse({
      data: { device_id: 'abc', alert_type: 'intrusion' },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.data?.['device_id']).toBe('abc');
    }
  });
});

describe('SSEEventType', () => {
  it('has expected values', () => {
    expect(SSEEventType.Init).toBe('init');
    expect(SSEEventType.TextDelta).toBe('text_delta');
    expect(SSEEventType.ToolCallStart).toBe('tool_call_start');
    expect(SSEEventType.ToolCallResult).toBe('tool_call_result');
    expect(SSEEventType.Error).toBe('error');
    expect(SSEEventType.Done).toBe('done');
  });
});
