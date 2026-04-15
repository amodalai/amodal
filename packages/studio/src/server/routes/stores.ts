/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import { Router } from 'express';
import { asyncHandler } from '../route-helpers.js';
import { getAgentId } from '../../lib/config.js';
import { listStores, listDocuments, getDocument, getDocumentHistory } from '../../lib/store-queries.js';

export const storesRouter = Router();

// List all stores
storesRouter.get('/api/studio/stores', asyncHandler(async (_req, res) => {
  const agentId = getAgentId();
  const stores = await listStores(agentId);
  res.json({ stores });
}));

// List documents in a store
storesRouter.get('/api/studio/stores/:name/documents', asyncHandler(async (req, res) => {
  const agentId = getAgentId();
  const name = String(req.params['name'] ?? '');
  const documents = await listDocuments(agentId, name);
  res.json({ documents });
}));

// Get a single document with history
storesRouter.get('/api/studio/stores/:name/documents/:key', asyncHandler(async (req, res) => {
  const agentId = getAgentId();
  const name = String(req.params['name'] ?? '');
  const key = String(req.params['key'] ?? '');

  const [document, history] = await Promise.all([
    getDocument(agentId, name, key),
    getDocumentHistory(agentId, name, key),
  ]);

  if (!document) {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: `Document not found: ${name}/${key}` } });
    return;
  }

  res.json({ document, history });
}));
