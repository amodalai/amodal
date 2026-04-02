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
    });
    expect(result.success).toBe(true);
  });

  it('should reject empty message', () => {
    const result = AgentChatRequestSchema.safeParse({
      message: '',
    });
    expect(result.success).toBe(false);
  });

  it('should accept optional fields', () => {
    const result = AgentChatRequestSchema.safeParse({
      message: 'hello',
      session_id: 'sess-1',
      context: {key: 'value'},
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.session_id).toBe('sess-1');
    }
  });
});
