/**
 * @license
 * Copyright 2025 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import {describe, it, expect} from 'vitest';
import {AgentChatRequestSchema} from './agent-types.js';

describe('AgentChatRequestSchema', () => {
  it('should accept a valid request', () => {
    const result = AgentChatRequestSchema.safeParse({
      message: 'hello',
      app_id: 'tenant-1',
    });
    expect(result.success).toBe(true);
  });

  it('should reject empty message', () => {
    const result = AgentChatRequestSchema.safeParse({
      message: '',
      app_id: 'tenant-1',
    });
    expect(result.success).toBe(false);
  });

  it('should reject missing app_id', () => {
    const result = AgentChatRequestSchema.safeParse({
      message: 'hello',
    });
    expect(result.success).toBe(false);
  });

  it('should accept optional fields', () => {
    const result = AgentChatRequestSchema.safeParse({
      message: 'hello',
      app_id: 'tenant-1',
      session_id: 'sess-1',
      app_token: 'tok-1',
      context: {key: 'value'},
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.session_id).toBe('sess-1');
      expect(result.data.app_token).toBe('tok-1');
    }
  });
});
