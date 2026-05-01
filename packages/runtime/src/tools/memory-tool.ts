/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

/**
 * Built-in memory tool — per-instance persistent memory with entry-level operations.
 *
 * Supports add, remove, list, and search actions. Each memory entry is stored
 * as a separate row in the agent_memory_entries table, scoped by appId.
 */

import {z} from 'zod';
import {eq, and, sql} from 'drizzle-orm';
import type {NodePgDatabase} from 'drizzle-orm/node-postgres';
import {agentMemoryEntries} from '@amodalai/db';

import type {ToolDefinition, ToolContext} from './types.js';
import {StoreError} from '../errors.js';
import type {Logger} from '../logger.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const MEMORY_TOOL_NAME = 'memory';

/** Timeout for memory database operations. */
const MEMORY_DB_TIMEOUT_MS = 5_000;

// Keep the old name for backward compat during migration
export const UPDATE_MEMORY_TOOL_NAME = MEMORY_TOOL_NAME;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Race a promise against a timeout signal so a hung DB doesn't block forever. */
function withDbTimeout<T>(promise: Promise<T>, label: string): Promise<T> {
  const signal = AbortSignal.timeout(MEMORY_DB_TIMEOUT_MS);
  return new Promise<T>((resolve, reject) => {
    signal.addEventListener('abort', () => {
      reject(new StoreError(`Memory DB operation timed out: ${label}`, {
        store: 'agent_memory_entries',
        operation: label,
        context: {timeoutMs: MEMORY_DB_TIMEOUT_MS},
      }));
    });
    promise.then(resolve, reject);
  });
}

export interface MemoryEntry {
  id: string;
  content: string;
  category: string | null;
  createdAt: Date;
}

// ---------------------------------------------------------------------------
// Memory read helper (used by session builder to inject into prompt)
// ---------------------------------------------------------------------------

/**
 * Load all memory entries for an appId and scopeId, ordered by creation time.
 * Returns an empty array if no entries exist.
 */
export async function loadMemoryEntries(
  db: NodePgDatabase<Record<string, unknown>>,
  appId: string,
  scopeId = '',
): Promise<MemoryEntry[]> {
  const rows = await withDbTimeout(
    db
      .select({
        id: agentMemoryEntries.id,
        content: agentMemoryEntries.content,
        category: agentMemoryEntries.category,
        createdAt: agentMemoryEntries.createdAt,
      })
      .from(agentMemoryEntries)
      .where(and(
        eq(agentMemoryEntries.appId, appId),
        eq(agentMemoryEntries.scopeId, scopeId),
      ))
      .orderBy(agentMemoryEntries.createdAt),
    'load_entries',
  );

  return rows;
}

/**
 * Format memory entries as a string for system prompt injection.
 * Returns empty string if no entries.
 */
export function formatMemoryForPrompt(entries: MemoryEntry[]): string {
  if (entries.length === 0) return '';
  return entries
    .map((e, i) => `${String(i + 1)}. ${e.content} [id: ${e.id.slice(0, 8)}]`)
    .join('\n');
}

// String form of loadMemoryEntries, for callers that want the prompt-ready text directly.
export async function loadMemoryContent(
  db: NodePgDatabase<Record<string, unknown>>,
  appId = 'local',
  scopeId = '',
): Promise<string> {
  const entries = await loadMemoryEntries(db, appId, scopeId);
  return formatMemoryForPrompt(entries);
}

// ---------------------------------------------------------------------------
// Tool factory
// ---------------------------------------------------------------------------

export interface CreateMemoryToolOptions {
  db: NodePgDatabase<Record<string, unknown>>;
  logger: Logger;
  appId: string;
  /** Scope ID for per-user memory isolation. Default: '' (agent-level). */
  scopeId?: string;
  maxEntries?: number;
  maxTotalChars?: number;
}

/**
 * Create the memory tool definition with add/remove/list/search actions.
 */
export function createMemoryTool(opts: CreateMemoryToolOptions): ToolDefinition {
  const {db, logger, appId, scopeId = '', maxEntries = 50, maxTotalChars = 8000} = opts;

  return {
    description:
      'Manage persistent memory. Use "add" to save a fact, "remove" to delete by ID, ' +
      '"list" to see all entries, "search" to find entries by keyword.',
    parameters: z.object({
      action: z.enum(['add', 'remove', 'list', 'search']).describe(
        'The action to perform on memory.',
      ),
      content: z.string().optional().describe(
        'The memory content to save. Required for "add".',
      ),
      entry_id: z.string().optional().describe(
        'The entry ID to remove. Required for "remove". Use the short ID shown in brackets.',
      ),
      query: z.string().optional().describe(
        'Search query for finding entries. Required for "search".',
      ),
    }),
    readOnly: false,
    metadata: {category: 'system'},
    runningLabel: 'Memory: {{action}}',
    completedLabel: 'Memory: {{action}}',

    async execute(
      params: {action: string; content?: string; entry_id?: string; query?: string},
      _ctx: ToolContext,
    ): Promise<unknown> {
      const startMs = Date.now();

      try {
        switch (params.action) {
          case 'add':
            return await handleAdd(db, logger, appId, scopeId, params.content, maxEntries, maxTotalChars, startMs);
          case 'remove':
            return await handleRemove(db, logger, appId, scopeId, params.entry_id, startMs);
          case 'list':
            return await handleList(db, logger, appId, scopeId, startMs);
          case 'search':
            return await handleSearch(db, logger, appId, scopeId, params.query, startMs);
          default:
            throw new StoreError(`Unknown memory action: ${params.action}`, {
              store: 'agent_memory_entries',
              operation: 'unknown',
              context: {action: params.action},
            });
        }
      } catch (err) {
        if (err instanceof StoreError) throw err;
        const durationMs = Date.now() - startMs;
        logger.error('memory_operation_failed', {
          action: params.action,
          durationMs,
          error: err instanceof Error ? err.message : String(err),
        });
        throw new StoreError(`Memory ${params.action} failed`, {
          store: 'agent_memory_entries',
          operation: params.action,
          cause: err,
          context: {appId, scopeId},
        });
      }
    },
  };
}

// ---------------------------------------------------------------------------
// Action handlers
// ---------------------------------------------------------------------------

async function handleAdd(
  db: NodePgDatabase<Record<string, unknown>>,
  logger: Logger,
  appId: string,
  scopeId: string,
  content: string | undefined,
  maxEntries: number,
  maxTotalChars: number,
  startMs: number,
): Promise<unknown> {
  if (!content || content.trim().length === 0) {
    throw new StoreError('Content is required for add action', {
      store: 'agent_memory_entries',
      operation: 'add',
      context: {appId, scopeId},
    });
  }

  // Check budget
  const existing = await withDbTimeout(
    db
      .select({
        id: agentMemoryEntries.id,
        content: agentMemoryEntries.content,
      })
      .from(agentMemoryEntries)
      .where(and(
        eq(agentMemoryEntries.appId, appId),
        eq(agentMemoryEntries.scopeId, scopeId),
      )),
    'budget_check',
  );

  if (existing.length >= maxEntries) {
    return {
      error: 'budget_exceeded',
      message: `Memory is full (${String(existing.length)}/${String(maxEntries)} entries). Remove stale entries before adding new ones.`,
      entries: existing.length,
      maxEntries,
    };
  }

  const totalChars = existing.reduce((sum, e) => sum + e.content.length, 0);
  if (totalChars + content.length > maxTotalChars) {
    return {
      error: 'budget_exceeded',
      message: `Memory content budget exceeded (${String(totalChars + content.length)}/${String(maxTotalChars)} chars). Remove stale entries before adding new ones.`,
      currentChars: totalChars,
      maxTotalChars,
    };
  }

  // Insert
  const [inserted] = await withDbTimeout(
    db
      .insert(agentMemoryEntries)
      .values({appId, scopeId, content: content.trim()})
      .returning({
        id: agentMemoryEntries.id,
        content: agentMemoryEntries.content,
        createdAt: agentMemoryEntries.createdAt,
      }),
    'add',
  );

  const durationMs = Date.now() - startMs;
  logger.info('memory_entry_added', {appId, scopeId, entryId: inserted.id, contentLength: content.length, durationMs});

  // Return the full updated list so the LLM has mid-session visibility
  const allEntries = await loadMemoryEntries(db, appId, scopeId);
  return {
    added: {id: inserted.id, content: inserted.content},
    entries: allEntries.map((e, i) => ({index: i + 1, id: e.id.slice(0, 8), content: e.content})),
    totalEntries: allEntries.length,
  };
}

async function handleRemove(
  db: NodePgDatabase<Record<string, unknown>>,
  logger: Logger,
  appId: string,
  scopeId: string,
  entryId: string | undefined,
  startMs: number,
): Promise<unknown> {
  if (!entryId || entryId.trim().length === 0) {
    throw new StoreError('entry_id is required for remove action', {
      store: 'agent_memory_entries',
      operation: 'remove',
      context: {appId, scopeId},
    });
  }

  // Support both short IDs (first 8 chars) and full UUIDs
  const idPattern = entryId.trim();
  const deleted = await withDbTimeout(
    db
      .delete(agentMemoryEntries)
      .where(
        and(
          eq(agentMemoryEntries.appId, appId),
          eq(agentMemoryEntries.scopeId, scopeId),
          sql`${agentMemoryEntries.id}::text LIKE ${idPattern + '%'}`,
        ),
      )
      .returning({id: agentMemoryEntries.id, content: agentMemoryEntries.content}),
    'remove',
  );

  const durationMs = Date.now() - startMs;

  if (deleted.length === 0) {
    logger.info('memory_entry_not_found', {appId, scopeId, entryId: idPattern, durationMs});
    return {removed: false, message: `No entry found matching ID "${idPattern}".`};
  }

  logger.info('memory_entry_removed', {appId, scopeId, entryId: deleted[0].id, durationMs});

  const allEntries = await loadMemoryEntries(db, appId, scopeId);
  return {
    removed: true,
    deletedEntry: {id: deleted[0].id, content: deleted[0].content},
    entries: allEntries.map((e, i) => ({index: i + 1, id: e.id.slice(0, 8), content: e.content})),
    totalEntries: allEntries.length,
  };
}

async function handleList(
  db: NodePgDatabase<Record<string, unknown>>,
  logger: Logger,
  appId: string,
  scopeId: string,
  startMs: number,
): Promise<unknown> {
  const entries = await loadMemoryEntries(db, appId, scopeId);
  const durationMs = Date.now() - startMs;

  logger.info('memory_listed', {appId, scopeId, entryCount: entries.length, durationMs});

  if (entries.length === 0) {
    return {entries: [], message: 'No memories saved yet.'};
  }

  return {
    entries: entries.map((e, i) => ({index: i + 1, id: e.id.slice(0, 8), content: e.content, category: e.category})),
    totalEntries: entries.length,
  };
}

async function handleSearch(
  db: NodePgDatabase<Record<string, unknown>>,
  logger: Logger,
  appId: string,
  scopeId: string,
  query: string | undefined,
  startMs: number,
): Promise<unknown> {
  if (!query || query.trim().length === 0) {
    throw new StoreError('query is required for search action', {
      store: 'agent_memory_entries',
      operation: 'search',
      context: {appId, scopeId},
    });
  }

  // Use plainto_tsquery for safe user input (no syntax errors from special chars)
  const results = await withDbTimeout(
    db
      .select({
        id: agentMemoryEntries.id,
        content: agentMemoryEntries.content,
        category: agentMemoryEntries.category,
        createdAt: agentMemoryEntries.createdAt,
        rank: sql<number>`ts_rank(to_tsvector('english', ${agentMemoryEntries.content}), plainto_tsquery('english', ${query.trim()}))`,
      })
      .from(agentMemoryEntries)
      .where(
        and(
          eq(agentMemoryEntries.appId, appId),
          eq(agentMemoryEntries.scopeId, scopeId),
          sql`to_tsvector('english', ${agentMemoryEntries.content}) @@ plainto_tsquery('english', ${query.trim()})`,
        ),
      )
      .orderBy(sql`ts_rank(to_tsvector('english', ${agentMemoryEntries.content}), plainto_tsquery('english', ${query.trim()})) DESC`)
      .limit(10),
    'search',
  );

  const durationMs = Date.now() - startMs;
  logger.info('memory_searched', {appId, scopeId, query: query.trim(), resultCount: results.length, durationMs});

  if (results.length === 0) {
    return {results: [], message: `No memories found matching "${query.trim()}".`};
  }

  return {
    results: results.map((r) => ({id: r.id.slice(0, 8), content: r.content, category: r.category})),
    totalResults: results.length,
  };
}
