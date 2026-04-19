/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

/**
 * Tests for the update_memory tool and loadMemoryContent helper.
 *
 * Covers:
 * 1. loadMemoryContent — reads from db, returns empty string when no row
 * 2. createUpdateMemoryTool — upsert semantics, return shape, logging
 * 3. Error handling — wraps db errors as StoreError
 */

import {describe, it, expect, vi, beforeEach} from 'vitest';
import {
  loadMemoryContent,
  createUpdateMemoryTool,
  UPDATE_MEMORY_TOOL_NAME,
} from './memory-tool.js';
import {StoreError} from '../errors.js';
import type {ToolContext} from './types.js';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

// Mock drizzle db with chainable query builder
function createMockDb() {
  const state = {
    rows: [] as Array<{content: string}>,
    insertedValues: null as Record<string, unknown> | null,
    conflictSet: null as Record<string, unknown> | null,
  };

  // Chainable select builder
  const selectBuilder = {
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    limit: vi.fn().mockImplementation(() => Promise.resolve(state.rows)),
  };

  // Chainable insert builder
  const insertBuilder = {
    values: vi.fn().mockImplementation((vals: Record<string, unknown>) => {
      state.insertedValues = vals;
      return insertBuilder;
    }),
    onConflictDoUpdate: vi.fn().mockImplementation((opts: {set: Record<string, unknown>}) => {
      state.conflictSet = opts.set;
      return Promise.resolve();
    }),
  };

  const db = {
    select: vi.fn().mockReturnValue(selectBuilder),
    insert: vi.fn().mockReturnValue(insertBuilder),
  };

  return {db, state, selectBuilder, insertBuilder};
}

function createMockLogger() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    child: vi.fn(),
  };
}

const mockCtx: ToolContext = {
  request: vi.fn(),
  store: vi.fn(),
  env: vi.fn(),
  log: vi.fn(),
  signal: AbortSignal.timeout(5000),
  sessionId: 'test-session',
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('UPDATE_MEMORY_TOOL_NAME', () => {
  it('is update_memory', () => {
    expect(UPDATE_MEMORY_TOOL_NAME).toBe('update_memory');
  });
});

describe('loadMemoryContent', () => {
  it('returns content when row exists', async () => {
    const {db, state} = createMockDb();
    state.rows = [{content: 'User prefers dark mode.'}];

    const result = await loadMemoryContent(db as never);

    expect(result).toBe('User prefers dark mode.');
  });

  it('returns empty string when no row exists', async () => {
    const {db, state} = createMockDb();
    state.rows = [];

    const result = await loadMemoryContent(db as never);

    expect(result).toBe('');
  });
});

describe('createUpdateMemoryTool', () => {
  let mockDb: ReturnType<typeof createMockDb>;
  let logger: ReturnType<typeof createMockLogger>;

  beforeEach(() => {
    mockDb = createMockDb();
    logger = createMockLogger();
  });

  it('returns a tool definition with correct metadata', () => {
    const tool = createUpdateMemoryTool(mockDb.db as never, logger as never);

    expect(tool.description).toContain('persistent memory');
    expect(tool.description).toContain('COMPLETE updated memory');
    expect(tool.readOnly).toBe(false);
    expect(tool.metadata).toEqual({category: 'system'});
  });

  it('upserts content and returns success', async () => {
    const tool = createUpdateMemoryTool(mockDb.db as never, logger as never);

    const result = await tool.execute(
      {content: 'User prefers dark mode.'},
      mockCtx,
    );

    expect(result).toEqual({updated: true, contentLength: 23});
    expect(mockDb.db.insert).toHaveBeenCalled();
    expect(mockDb.insertBuilder.values).toHaveBeenCalledWith(
      expect.objectContaining({id: 1, content: 'User prefers dark mode.'}),
    );
    expect(mockDb.insertBuilder.onConflictDoUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        set: expect.objectContaining({content: 'User prefers dark mode.'}),
      }),
    );
  });

  it('logs memory_updated on success', async () => {
    const tool = createUpdateMemoryTool(mockDb.db as never, logger as never);

    await tool.execute({content: 'Notes here.'}, mockCtx);

    expect(logger.info).toHaveBeenCalledWith('memory_updated', {
      contentLength: 11,
      durationMs: expect.any(Number),
    });
  });

  it('handles empty content', async () => {
    const tool = createUpdateMemoryTool(mockDb.db as never, logger as never);

    const result = await tool.execute({content: ''}, mockCtx);

    expect(result).toEqual({updated: true, contentLength: 0});
  });

  it('throws StoreError on db failure', async () => {
    mockDb.insertBuilder.onConflictDoUpdate.mockRejectedValue(
      new Error('connection refused'),
    );
    const tool = createUpdateMemoryTool(mockDb.db as never, logger as never);

    await expect(
      tool.execute({content: 'test'}, mockCtx),
    ).rejects.toThrow(StoreError);
  });

  it('logs memory_update_failed on db failure', async () => {
    mockDb.insertBuilder.onConflictDoUpdate.mockRejectedValue(
      new Error('connection refused'),
    );
    const tool = createUpdateMemoryTool(mockDb.db as never, logger as never);

    await expect(
      tool.execute({content: 'test'}, mockCtx),
    ).rejects.toThrow();

    expect(logger.error).toHaveBeenCalledWith('memory_update_failed', {
      durationMs: expect.any(Number),
      error: 'connection refused',
    });
  });

  it('StoreError carries context about the failed operation', async () => {
    mockDb.insertBuilder.onConflictDoUpdate.mockRejectedValue(
      new Error('timeout'),
    );
    const tool = createUpdateMemoryTool(mockDb.db as never, logger as never);

    try {
      await tool.execute({content: 'some notes'}, mockCtx);
      expect.fail('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(StoreError);
      const storeErr = err as StoreError;
      expect(storeErr.store).toBe('agent_memory');
      expect(storeErr.operation).toBe('upsert');
    }
  });
});
