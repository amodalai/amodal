/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import { Router } from 'express';
import { asyncHandler } from '../route-helpers.js';
import { getUser } from '../middleware/auth.js';
import { getBackend } from '../../lib/startup.js';
import { validateDraftPath } from '../../lib/draft-path.js';
import type { BatchRequest } from '../../lib/types.js';

export const draftsRouter = Router();

// List all drafts
draftsRouter.get('/api/studio/drafts', asyncHandler(async (req, res) => {
  const user = await getUser(req);
  const backend = await getBackend();
  const drafts = await backend.listDrafts(user.userId);
  res.json(drafts);
}));

// Batch operations — must be before the wildcard routes
draftsRouter.post('/api/studio/drafts/batch', asyncHandler(async (req, res) => {
  const user = await getUser(req);
  const backend = await getBackend();
  const body = req.body as unknown;

  if (typeof body !== 'object' || body === null || !('changes' in body)) {
    res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'Request body must include a "changes" array' } });
    return;
  }

  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- validated object at system boundary
  const { changes } = body as BatchRequest;
  if (!Array.isArray(changes)) {
    res.status(400).json({ error: { code: 'BAD_REQUEST', message: '"changes" must be an array' } });
    return;
  }

  for (const change of changes) {
    const validatedPath = validateDraftPath(change.path);
    if (change.action === 'upsert') {
      if (typeof change.content !== 'string') {
        res.status(400).json({ error: { code: 'BAD_REQUEST', message: `Missing content for upsert of "${change.path}"` } });
        return;
      }
      await backend.saveDraft(user.userId, validatedPath, change.content);
    } else if (change.action === 'delete') {
      await backend.deleteDraft(user.userId, validatedPath);
    } else {
      res.status(400).json({
        error: {
          code: 'BAD_REQUEST',
          message: `Invalid action for path "${String(change.path)}". Must be "upsert" or "delete".`,
        },
      });
      return;
    }
  }

  res.json({ accepted: changes.length });
}));

// Read a single draft (wildcard)
draftsRouter.get('/api/studio/drafts/{*filePath}', asyncHandler(async (req, res) => {
  const filePath = String(req.params['filePath'] ?? '');
  const validatedPath = validateDraftPath(filePath);
  const user = await getUser(req);
  const backend = await getBackend();
  const draft = await backend.readDraft(user.userId, validatedPath);

  if (!draft) {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: `Draft not found: ${validatedPath}` } });
    return;
  }

  res.json(draft);
}));

// Save (upsert) a draft (wildcard)
draftsRouter.put('/api/studio/drafts/{*filePath}', asyncHandler(async (req, res) => {
  const filePath = String(req.params['filePath'] ?? '');
  const validatedPath = validateDraftPath(filePath);
  const user = await getUser(req);
  const backend = await getBackend();

  let content: string;
  if (typeof req.body === 'string') {
    // text/plain body
    content = req.body;
  } else if (typeof req.body === 'object' && req.body !== null && 'content' in req.body) {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- validated object at system boundary
    content = String((req.body as Record<string, unknown>)['content']);
  } else {
    res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'Request body must be text or JSON with a "content" field' } });
    return;
  }

  await backend.saveDraft(user.userId, validatedPath, content);
  res.json({ ok: true });
}));

// Delete a draft (wildcard)
draftsRouter.delete('/api/studio/drafts/{*filePath}', asyncHandler(async (req, res) => {
  const filePath = String(req.params['filePath'] ?? '');
  const validatedPath = validateDraftPath(filePath);
  const user = await getUser(req);
  const backend = await getBackend();
  await backend.deleteDraft(user.userId, validatedPath);
  res.json({ ok: true });
}));
