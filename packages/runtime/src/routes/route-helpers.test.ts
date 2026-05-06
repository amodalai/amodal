/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import {describe, expect, it, vi} from 'vitest';
import type {Session, TurnUsage} from '../session/types.js';
import {adaptOnUsage} from './route-helpers.js';

describe('adaptOnUsage', () => {
  it('includes the runtime session id in usage reports', () => {
    const onUsageReport = vi.fn();
    const session = {
      id: 'session-1',
      model: 'claude-sonnet-4-20250514',
    } as Session;
    const usage: TurnUsage = {
      inputTokens: 100,
      outputTokens: 50,
      cachedInputTokens: 25,
      cacheCreationInputTokens: 0,
      totalTokens: 175,
      turnNumber: 1,
    };

    adaptOnUsage({onUsageReport}, session)?.(usage);

    expect(onUsageReport).toHaveBeenCalledWith({
      sessionId: 'session-1',
      model: 'claude-sonnet-4-20250514',
      taskAgentRuns: 0,
      tokens: {
        inputTokens: 100,
        outputTokens: 50,
        cachedTokens: 25,
      },
    });
  });
});
