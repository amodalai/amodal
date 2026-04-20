/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import { Hono } from 'hono';
import { getAgentId } from '../../lib/config.js';
import { listStores, listDocuments, getDocument, getDocumentHistory } from '../../lib/store-queries.js';

export const storesRoutes = new Hono();

// List all stores
storesRoutes.get('/api/stores', async (c) => {
  const agentId = getAgentId();
  const stores = await listStores(agentId);
  return c.json({ stores });
});

// List documents in a store
storesRoutes.get('/api/stores/:name/documents', async (c) => {
  const agentId = getAgentId();
  const name = c.req.param('name');
  const documents = await listDocuments(agentId, name);
  return c.json({ documents });
});

// Get a single document with history
storesRoutes.get('/api/stores/:name/documents/:key', async (c) => {
  const agentId = getAgentId();
  const name = c.req.param('name');
  const key = c.req.param('key');

  const [document, history] = await Promise.all([
    getDocument(agentId, name, key),
    getDocumentHistory(agentId, name, key),
  ]);

  if (!document) {
    return c.json({ error: { code: 'NOT_FOUND', message: `Document not found: ${name}/${key}` } }, 404);
  }

  return c.json({ document, history });
});
