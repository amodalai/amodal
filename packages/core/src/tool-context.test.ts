/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import { describe, it, expect } from 'vitest';
import type { ToolContext } from './tool-context.js';
import { KnowledgeStore } from './knowledge/knowledge-store.js';

describe('ToolContext', () => {
  it('should be implementable as a plain object', () => {
    const store = new KnowledgeStore([], []);

    const ctx: ToolContext = {
      getSessionId: () => 'test-session',
      getPlatformApiUrl: () => 'https://example.com',
      getPlatformApiKey: () => 'test-key',
      getApplicationId: () => 'app-1',
      getTenantId: () => 'tenant-1',
      getAuditLogger: () => undefined,
      getConnections: () => ({}),
      getKnowledgeStore: () => store,
      getConnectionInfos: () => [],
      getAgentContext: () => 'Test context',
    };

    expect(ctx.getSessionId()).toBe('test-session');
    expect(ctx.getPlatformApiUrl()).toBe('https://example.com');
    expect(ctx.getKnowledgeStore()).toBe(store);
  });
});
