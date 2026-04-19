/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

/**
 * Built-in update_memory tool.
 *
 * Replaces the entire memory blob for the current agent instance.
 * The agent reads its current memory from the system prompt and
 * writes the full updated blob here — it's an overwrite, not an append.
 */

import {z} from 'zod';
import {eq, sql} from 'drizzle-orm';
import type {NodePgDatabase} from 'drizzle-orm/node-postgres';
import {agentMemory} from '@amodalai/db';

import type {ToolDefinition, ToolContext} from './types.js';
import {StoreError} from '../errors.js';
import type {Logger} from '../logger.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const UPDATE_MEMORY_TOOL_NAME = 'update_memory';

// ---------------------------------------------------------------------------
// Memory read helper (used by session builder)
// ---------------------------------------------------------------------------

/**
 * Load the current memory content from the database.
 * Returns an empty string if no memory row exists yet.
 */
export async function loadMemoryContent(
  db: NodePgDatabase<Record<string, unknown>>,
): Promise<string> {
  const rows = await db
    .select({content: agentMemory.content})
    .from(agentMemory)
    .where(eq(agentMemory.id, 1))
    .limit(1);

  if (rows.length === 0) {
    return '';
  }
  return rows[0].content;
}

// ---------------------------------------------------------------------------
// Tool factory
// ---------------------------------------------------------------------------

/**
 * Create the update_memory tool definition.
 *
 * The tool upserts the single memory row (id=1) with the new content.
 */
export function createUpdateMemoryTool(
  db: NodePgDatabase<Record<string, unknown>>,
  logger: Logger,
): ToolDefinition {
  return {
    description:
      'Update the persistent memory for this user. Pass the COMPLETE updated memory — this replaces the entire contents. ' +
      'Read the current memory from your context, decide what to add/change/remove, and write the full result.',
    parameters: z.object({
      content: z.string().describe(
        'The full updated memory content. This replaces all existing memory.',
      ),
    }),
    readOnly: false,
    metadata: {category: 'system'},

    async execute(
      params: {content: string},
      _ctx: ToolContext,
    ): Promise<unknown> {
      const startMs = Date.now();

      try {
        await db
          .insert(agentMemory)
          .values({
            id: 1,
            content: params.content,
            updatedAt: sql`NOW()`,
          })
          .onConflictDoUpdate({
            target: agentMemory.id,
            set: {
              content: params.content,
              updatedAt: sql`NOW()`,
            },
          });

        const durationMs = Date.now() - startMs;
        logger.info('memory_updated', {
          contentLength: params.content.length,
          durationMs,
        });

        return {updated: true, contentLength: params.content.length};
      } catch (err) {
        const durationMs = Date.now() - startMs;
        logger.error('memory_update_failed', {
          durationMs,
          error: err instanceof Error ? err.message : String(err),
        });
        throw new StoreError('Failed to update agent memory', {
          store: 'agent_memory',
          operation: 'upsert',
          cause: err,
          context: {contentLength: params.content.length},
        });
      }
    },
  };
}
