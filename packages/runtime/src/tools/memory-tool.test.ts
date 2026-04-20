/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

/**
 * Tests for the memory tool with entry-level operations.
 *
 * Covers:
 * 1. formatMemoryForPrompt — renders entries as numbered list
 * 2. createMemoryTool — tool metadata, validation errors for each action
 * 3. Integration tests for add/remove/list/search run in the smoke test (requires Postgres)
 */

import {describe, it, expect, vi} from 'vitest';
import {
  formatMemoryForPrompt,
  createMemoryTool,
  MEMORY_TOOL_NAME,
  UPDATE_MEMORY_TOOL_NAME,
} from './memory-tool.js';
import type {MemoryEntry} from './memory-tool.js';
import {StoreError} from '../errors.js';
import type {ToolContext} from './types.js';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

function createMockLogger() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    child: vi.fn(),
  };
}

// Minimal mock that throws on any DB operation — used to test validation-only paths
function createThrowingDb() {
  const thrower = () => { throw new Error('unexpected DB call'); };
  return {
    select: thrower,
    insert: thrower,
    delete: thrower,
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

describe('MEMORY_TOOL_NAME', () => {
  it('is "memory"', () => {
    expect(MEMORY_TOOL_NAME).toBe('memory');
  });

  it('UPDATE_MEMORY_TOOL_NAME is backward-compat alias', () => {
    expect(UPDATE_MEMORY_TOOL_NAME).toBe(MEMORY_TOOL_NAME);
  });
});

describe('formatMemoryForPrompt', () => {
  it('formats entries as numbered list with short IDs', () => {
    const entries: MemoryEntry[] = [
      {id: 'abcdef12-3456-7890-abcd-ef1234567890', content: 'User prefers dark mode', category: null, createdAt: new Date()},
      {id: '12345678-abcd-ef12-3456-7890abcdef12', content: 'User is a dentist', category: null, createdAt: new Date()},
    ];

    const result = formatMemoryForPrompt(entries);

    expect(result).toBe(
      '1. User prefers dark mode [id: abcdef12]\n' +
      '2. User is a dentist [id: 12345678]',
    );
  });

  it('returns empty string for empty entries', () => {
    expect(formatMemoryForPrompt([])).toBe('');
  });

  it('handles single entry', () => {
    const entries: MemoryEntry[] = [
      {id: 'aaa11111-2222-3333-4444-555566667777', content: 'Likes TypeScript', category: null, createdAt: new Date()},
    ];

    expect(formatMemoryForPrompt(entries)).toBe('1. Likes TypeScript [id: aaa11111]');
  });
});

describe('createMemoryTool', () => {
  it('returns a tool definition with correct metadata', () => {
    const tool = createMemoryTool({
      db: createThrowingDb() as never,
      logger: createMockLogger() as never,
      appId: 'test',
    });

    expect(tool.description).toContain('persistent memory');
    expect(tool.description).toContain('add');
    expect(tool.description).toContain('remove');
    expect(tool.description).toContain('list');
    expect(tool.description).toContain('search');
    expect(tool.readOnly).toBe(false);
    expect(tool.metadata).toEqual({category: 'system'});
  });

  describe('add action — validation', () => {
    it('rejects empty content', async () => {
      const tool = createMemoryTool({
        db: createThrowingDb() as never,
        logger: createMockLogger() as never,
        appId: 'test',
      });

      await expect(
        tool.execute({action: 'add', content: ''}, mockCtx),
      ).rejects.toThrow(StoreError);
    });

    it('rejects missing content', async () => {
      const tool = createMemoryTool({
        db: createThrowingDb() as never,
        logger: createMockLogger() as never,
        appId: 'test',
      });

      await expect(
        tool.execute({action: 'add'}, mockCtx),
      ).rejects.toThrow(StoreError);
    });

    it('rejects whitespace-only content', async () => {
      const tool = createMemoryTool({
        db: createThrowingDb() as never,
        logger: createMockLogger() as never,
        appId: 'test',
      });

      await expect(
        tool.execute({action: 'add', content: '   '}, mockCtx),
      ).rejects.toThrow(StoreError);
    });
  });

  describe('remove action — validation', () => {
    it('rejects missing entry_id', async () => {
      const tool = createMemoryTool({
        db: createThrowingDb() as never,
        logger: createMockLogger() as never,
        appId: 'test',
      });

      await expect(
        tool.execute({action: 'remove'}, mockCtx),
      ).rejects.toThrow(StoreError);
    });

    it('rejects empty entry_id', async () => {
      const tool = createMemoryTool({
        db: createThrowingDb() as never,
        logger: createMockLogger() as never,
        appId: 'test',
      });

      await expect(
        tool.execute({action: 'remove', entry_id: ''}, mockCtx),
      ).rejects.toThrow(StoreError);
    });
  });

  describe('search action — validation', () => {
    it('rejects empty query', async () => {
      const tool = createMemoryTool({
        db: createThrowingDb() as never,
        logger: createMockLogger() as never,
        appId: 'test',
      });

      await expect(
        tool.execute({action: 'search', query: ''}, mockCtx),
      ).rejects.toThrow(StoreError);
    });

    it('rejects missing query', async () => {
      const tool = createMemoryTool({
        db: createThrowingDb() as never,
        logger: createMockLogger() as never,
        appId: 'test',
      });

      await expect(
        tool.execute({action: 'search'}, mockCtx),
      ).rejects.toThrow(StoreError);
    });
  });
});
