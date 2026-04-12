/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Chainable mock db
// ---------------------------------------------------------------------------

function createChainableDb() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const chain: any = {};
  const methods = ['select', 'from', 'where', 'groupBy', 'orderBy', 'limit', 'update', 'set'];
  for (const m of methods) {
    chain[m] = vi.fn(() => chain);
  }
  return chain;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let mockDb: any;

vi.mock('../db', () => ({
  getStudioDb: vi.fn(async () => mockDb),
}));

// Mock @amodalai/db: schema tables + drizzle-orm operators (all re-exported)
vi.mock('@amodalai/db', () => ({
  feedback: {
    id: 'fb.id', agentId: 'fb.agentId', rating: 'fb.rating',
    createdAt: 'fb.createdAt', reviewedAt: 'fb.reviewedAt',
  },
  eq: (...args: unknown[]) => ({ op: 'eq', args }),
  desc: (col: unknown) => ({ op: 'desc', col }),
  count: () => ({ op: 'count' }),
  inArray: (...args: unknown[]) => ({ op: 'inArray', args }),
}));

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('feedback-queries', () => {
  beforeEach(() => {
    mockDb = createChainableDb();
  });

  it('listFeedback applies default limit of 500', async () => {
    mockDb.limit.mockReturnValueOnce(Promise.resolve([]));

    const { listFeedback } = await import('../feedback-queries');
    await listFeedback('my-agent');

    expect(mockDb.limit).toHaveBeenCalledWith(500);
  });

  it('listFeedback applies custom limit', async () => {
    mockDb.limit.mockReturnValueOnce(Promise.resolve([]));

    const { listFeedback } = await import('../feedback-queries');
    await listFeedback('my-agent', 50);

    expect(mockDb.limit).toHaveBeenCalledWith(50);
  });

  it('getFeedbackSummary aggregates up/down counts', async () => {
    mockDb.groupBy.mockReturnValueOnce(Promise.resolve([
      { rating: 'up', total: 10 },
      { rating: 'down', total: 3 },
    ]));

    const { getFeedbackSummary } = await import('../feedback-queries');
    const result = await getFeedbackSummary('my-agent');

    expect(result).toEqual({ up: 10, down: 3, total: 13 });
  });

  it('getFeedbackSummary handles missing ratings gracefully', async () => {
    mockDb.groupBy.mockReturnValueOnce(Promise.resolve([{ rating: 'up', total: 7 }]));

    const { getFeedbackSummary } = await import('../feedback-queries');
    const result = await getFeedbackSummary('my-agent');

    expect(result).toEqual({ up: 7, down: 0, total: 7 });
  });

  it('markFeedbackReviewed does nothing for empty array', async () => {
    const { markFeedbackReviewed } = await import('../feedback-queries');
    await markFeedbackReviewed([]);

    expect(mockDb.update).not.toHaveBeenCalled();
  });

  it('markFeedbackReviewed calls update/set/where for non-empty array', async () => {
    mockDb.where.mockReturnValueOnce(Promise.resolve(undefined));

    const { markFeedbackReviewed } = await import('../feedback-queries');
    await markFeedbackReviewed(['id-1', 'id-2']);

    expect(mockDb.update).toHaveBeenCalled();
    expect(mockDb.set).toHaveBeenCalled();
    expect(mockDb.where).toHaveBeenCalled();
  });
});
