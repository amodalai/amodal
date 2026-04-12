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
  const methods = ['select', 'from', 'where', 'groupBy', 'orderBy', 'limit', 'offset', '$dynamic'];
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
  storeDocuments: {
    appId: 'sd.appId', store: 'sd.store', key: 'sd.key', updatedAt: 'sd.updatedAt',
  },
  storeDocumentVersions: {
    appId: 'sdv.appId', store: 'sdv.store', key: 'sdv.key', version: 'sdv.version',
  },
  eq: (...args: unknown[]) => ({ op: 'eq', args }),
  desc: (col: unknown) => ({ op: 'desc', col }),
  and: (...args: unknown[]) => ({ op: 'and', args }),
  count: () => ({ op: 'count' }),
}));

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('store-queries', () => {
  beforeEach(() => {
    mockDb = createChainableDb();
  });

  it('listStores calls select/from/where/groupBy', async () => {
    const expected = [{ store: 'users', docCount: 5 }];
    mockDb.groupBy.mockReturnValueOnce(Promise.resolve(expected));

    const { listStores } = await import('../store-queries');
    const result = await listStores('my-agent');

    expect(mockDb.select).toHaveBeenCalled();
    expect(mockDb.from).toHaveBeenCalled();
    expect(mockDb.where).toHaveBeenCalled();
    expect(mockDb.groupBy).toHaveBeenCalled();
    expect(result).toEqual(expected);
  });

  it('listDocuments applies limit and offset when provided', async () => {
    mockDb.$dynamic.mockReturnValueOnce(mockDb);
    mockDb.offset.mockReturnValueOnce(Promise.resolve([]));

    const { listDocuments } = await import('../store-queries');
    await listDocuments('my-agent', 'users', { limit: 10, offset: 20 });

    expect(mockDb.limit).toHaveBeenCalledWith(10);
    expect(mockDb.offset).toHaveBeenCalledWith(20);
  });

  it('getDocument returns null when no rows found', async () => {
    mockDb.limit.mockReturnValueOnce(Promise.resolve([]));

    const { getDocument } = await import('../store-queries');
    const result = await getDocument('my-agent', 'users', 'missing-key');

    expect(result).toBeNull();
  });

  it('getDocument returns the first row when found', async () => {
    const doc = { appId: 'my-agent', store: 'users', key: 'alice', payload: {} };
    mockDb.limit.mockReturnValueOnce(Promise.resolve([doc]));

    const { getDocument } = await import('../store-queries');
    const result = await getDocument('my-agent', 'users', 'alice');

    expect(result).toEqual(doc);
  });

  it('getDocumentHistory orders by version desc', async () => {
    mockDb.orderBy.mockReturnValueOnce(Promise.resolve([]));

    const { getDocumentHistory } = await import('../store-queries');
    await getDocumentHistory('my-agent', 'users', 'alice');

    expect(mockDb.select).toHaveBeenCalled();
    expect(mockDb.orderBy).toHaveBeenCalled();
  });
});
