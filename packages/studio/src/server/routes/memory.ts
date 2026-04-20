/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import { Router } from 'express';
import { asyncHandler } from '../route-helpers.js';
import { getAgentId } from '../../lib/config.js';
import { listMemoryEntries, deleteMemoryEntry, updateMemoryEntry, addMemoryEntry } from '../../lib/memory-queries.js';

export const memoryRouter = Router();

// List all memory entries
memoryRouter.get('/api/studio/memory', asyncHandler(async (_req, res) => {
  const agentId = getAgentId();
  const entries = await listMemoryEntries(agentId);
  res.json({ entries });
}));

// Add a new memory entry
memoryRouter.post('/api/studio/memory', asyncHandler(async (req, res) => {
  const agentId = getAgentId();
  const body = req.body as unknown;
  if (typeof body !== 'object' || body === null) {
    res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'Request body must be a JSON object' } });
    return;
  }
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- validated object at system boundary
  const { content } = body as Record<string, unknown>;
  if (typeof content !== 'string' || content.trim().length === 0) {
    res.status(400).json({ error: { code: 'INVALID_INPUT', message: 'Content is required' } });
    return;
  }
  const entry = await addMemoryEntry(agentId, content.trim());
  res.status(201).json({ entry });
}));

// Update a memory entry
memoryRouter.patch('/api/studio/memory/:id', asyncHandler(async (req, res) => {
  const agentId = getAgentId();
  const id = String(req.params['id'] ?? '');
  const body = req.body as unknown;
  if (typeof body !== 'object' || body === null) {
    res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'Request body must be a JSON object' } });
    return;
  }
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- validated object at system boundary
  const { content } = body as Record<string, unknown>;
  if (typeof content !== 'string' || content.trim().length === 0) {
    res.status(400).json({ error: { code: 'INVALID_INPUT', message: 'Content is required' } });
    return;
  }
  const updated = await updateMemoryEntry(agentId, id, content.trim());
  if (!updated) {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: `Memory entry not found: ${id}` } });
    return;
  }
  res.json({ entry: updated });
}));

// Delete a memory entry
memoryRouter.delete('/api/studio/memory/:id', asyncHandler(async (req, res) => {
  const agentId = getAgentId();
  const id = String(req.params['id'] ?? '');
  const deleted = await deleteMemoryEntry(agentId, id);
  if (!deleted) {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: `Memory entry not found: ${id}` } });
    return;
  }
  res.json({ deleted: true });
}));
