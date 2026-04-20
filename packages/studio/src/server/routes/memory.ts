/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import { Hono } from 'hono';
import { getAgentId } from '../../lib/config.js';
import { listMemoryEntries, deleteMemoryEntry, updateMemoryEntry, addMemoryEntry } from '../../lib/memory-queries.js';

export const memoryRoutes = new Hono();

// List all memory entries
memoryRoutes.get('/api/memory', async (c) => {
  const agentId = getAgentId();
  const entries = await listMemoryEntries(agentId);
  return c.json({ entries });
});

// Add a new memory entry
memoryRoutes.post('/api/memory', async (c) => {
  const agentId = getAgentId();
  const body = await c.req.json<{ content?: string }>();
  const content = typeof body.content === 'string' ? body.content : undefined;
  if (!content || content.trim().length === 0) {
    return c.json({ error: { code: 'INVALID_INPUT', message: 'Content is required' } }, 400);
  }
  const entry = await addMemoryEntry(agentId, content.trim());
  return c.json({ entry }, 201);
});

// Update a memory entry
memoryRoutes.patch('/api/memory/:id', async (c) => {
  const agentId = getAgentId();
  const id = c.req.param('id');
  const body = await c.req.json<{ content?: string }>();
  const content = typeof body.content === 'string' ? body.content : undefined;
  if (!content || content.trim().length === 0) {
    return c.json({ error: { code: 'INVALID_INPUT', message: 'Content is required' } }, 400);
  }
  const updated = await updateMemoryEntry(agentId, id, content.trim());
  if (!updated) {
    return c.json({ error: { code: 'NOT_FOUND', message: `Memory entry not found: ${id}` } }, 404);
  }
  return c.json({ entry: updated });
});

// Delete a memory entry
memoryRoutes.delete('/api/memory/:id', async (c) => {
  const agentId = getAgentId();
  const id = c.req.param('id');
  const deleted = await deleteMemoryEntry(agentId, id);
  if (!deleted) {
    return c.json({ error: { code: 'NOT_FOUND', message: `Memory entry not found: ${id}` } }, 404);
  }
  return c.json({ deleted: true });
});
