/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import { Hono } from 'hono';
import { getUser } from '../middleware/auth.js';
import { getBackend } from '../../lib/startup.js';
import { validateDraftPath } from '../../lib/draft-path.js';
import type { BatchRequest } from '../../lib/types.js';

export const draftsRoutes = new Hono();

// List all drafts
draftsRoutes.get('/api/drafts', async (c) => {
  const user = await getUser(c.req.raw);
  const backend = await getBackend();
  const drafts = await backend.listDrafts(user.userId);
  return c.json({ drafts });
});

// Batch operations — must be before the wildcard routes
draftsRoutes.post('/api/drafts/batch', async (c) => {
  const user = await getUser(c.req.raw);
  const backend = await getBackend();
  const body = await c.req.json() as unknown;

  if (typeof body !== 'object' || body === null || !('changes' in body)) {
    return c.json({ error: { code: 'BAD_REQUEST', message: 'Request body must include a "changes" array' } }, 400);
  }

  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- validated object at system boundary
  const { changes } = body as BatchRequest;
  if (!Array.isArray(changes)) {
    return c.json({ error: { code: 'BAD_REQUEST', message: '"changes" must be an array' } }, 400);
  }

  for (const change of changes) {
    const validatedPath = validateDraftPath(change.path);
    if (change.action === 'upsert') {
      if (typeof change.content !== 'string') {
        return c.json({ error: { code: 'BAD_REQUEST', message: `Missing content for upsert of "${change.path}"` } }, 400);
      }
      await backend.saveDraft(user.userId, validatedPath, change.content);
    } else if (change.action === 'delete') {
      await backend.deleteDraft(user.userId, validatedPath);
    } else {
      return c.json({
        error: {
          code: 'BAD_REQUEST',
          message: `Invalid action for path "${String(change.path)}". Must be "upsert" or "delete".`,
        },
      }, 400);
    }
  }

  return c.json({ accepted: changes.length });
});

// Read a single draft (wildcard)
draftsRoutes.get('/api/drafts/*', async (c) => {
  const filePath = c.req.path.replace(/^\/api\/drafts\//, '');
  const validatedPath = validateDraftPath(filePath);
  const user = await getUser(c.req.raw);
  const backend = await getBackend();
  const draft = await backend.readDraft(user.userId, validatedPath);

  if (!draft) {
    return c.json({ error: { code: 'NOT_FOUND', message: `Draft not found: ${validatedPath}` } }, 404);
  }

  return c.json(draft);
});

// Save (upsert) a draft (wildcard)
draftsRoutes.put('/api/drafts/*', async (c) => {
  const filePath = c.req.path.replace(/^\/api\/drafts\//, '');
  const validatedPath = validateDraftPath(filePath);
  const user = await getUser(c.req.raw);
  const backend = await getBackend();

  const contentType = c.req.header('content-type') ?? '';
  let content: string;

  if (contentType.includes('text/plain')) {
    content = await c.req.text();
  } else {
    const body = await c.req.json() as unknown;
    if (typeof body === 'object' && body !== null && 'content' in body) {
       
      content = String((body as Record<string, unknown>)['content']);
    } else {
      return c.json({ error: { code: 'BAD_REQUEST', message: 'Request body must be text or JSON with a "content" field' } }, 400);
    }
  }

  await backend.saveDraft(user.userId, validatedPath, content);
  return c.json({ ok: true });
});

// Delete a draft (wildcard)
draftsRoutes.delete('/api/drafts/*', async (c) => {
  const filePath = c.req.path.replace(/^\/api\/drafts\//, '');
  const validatedPath = validateDraftPath(filePath);
  const user = await getUser(c.req.raw);
  const backend = await getBackend();
  await backend.deleteDraft(user.userId, validatedPath);
  return c.json({ ok: true });
});
