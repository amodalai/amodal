/**
 * @license
 * Copyright 2025 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import {Router} from 'express';
import type {Request, Response} from 'express';
import type {AgentBundle, StoreBackend} from '@amodalai/core';

export interface StoreRouterOptions {
  repo: AgentBundle;
  storeBackend: StoreBackend;
  appId: string;
}

/**
 * Creates routes for reading store data directly (without going through the LLM).
 *
 * GET  /api/stores              — list store definitions with doc counts
 * GET  /api/stores/:name        — list documents (filter, sort, limit, offset)
 * GET  /api/stores/:name/:key   — get single document + version history
 */
export function createStoresRouter(options: StoreRouterOptions): Router {
  const router = Router();
  const {repo, storeBackend, appId} = options;

  // List all store definitions with document counts
  // eslint-disable-next-line @typescript-eslint/no-misused-promises -- TODO: wrap async route handler
  router.get('/api/stores', async (_req: Request, res: Response) => {
    try {
      const stores = await Promise.all(
        repo.stores.map(async (store) => {
          const result = await storeBackend.list(appId, store.name, {limit: 0});
          return {
            name: store.name,
            entity: store.entity,
            ttl: store.ttl,
            trace: store.trace,
            history: store.history,
            documentCount: result.total,
          };
        }),
      );
      res.json({stores});
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({error: message});
    }
  });

  // List documents from a store
  // eslint-disable-next-line @typescript-eslint/no-misused-promises -- TODO: wrap async route handler
  router.get('/api/stores/:name', async (req: Request, res: Response) => {
    const storeName = req.params['name'] ?? '';

    // Verify store exists
    const store = repo.stores.find((s) => s.name === storeName);
    if (!store) {
      res.status(404).json({error: `Store "${storeName}" not found`});
      return;
    }

    // Parse query params
    let filter: Record<string, unknown> | undefined;
    if (req.query['filter']) {
      try {
        filter = JSON.parse(String(req.query['filter']));
      } catch {
        res.status(400).json({error: 'Invalid filter JSON'});
        return;
      }
    }

    const sort = req.query['sort'] ? String(req.query['sort']) : undefined;
    const limit = req.query['limit'] ? Number(req.query['limit']) : 20;
    const offset = req.query['offset'] ? Number(req.query['offset']) : 0;

    try {
      const result = await storeBackend.list(appId, storeName, {
        filter,
        sort,
        limit,
        offset,
      });
      res.json(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({error: message});
    }
  });

  // Get a single document + version history
  // eslint-disable-next-line @typescript-eslint/no-misused-promises -- TODO: wrap async route handler
  router.get('/api/stores/:name/:key', async (req: Request, res: Response) => {
    const storeName = req.params['name'] ?? '';
    const key = req.params['key'] ?? '';

    // Verify store exists
    const store = repo.stores.find((s) => s.name === storeName);
    if (!store) {
      res.status(404).json({error: `Store "${storeName}" not found`});
      return;
    }

    try {
      const document = await storeBackend.get(appId, storeName, key);
      if (!document) {
        res.status(404).json({error: `Document "${key}" not found in store "${storeName}"`});
        return;
      }

      // Include history if the store has versioning configured
      let history: unknown[] = [];
      if (store.history) {
        history = await storeBackend.history(appId, storeName, key);
      }

      res.json({document, history});
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({error: message});
    }
  });

  // Write a document to a store (for seeding/testing)
  // eslint-disable-next-line @typescript-eslint/no-misused-promises -- TODO: wrap async route handler
  router.post('/api/stores/:name', async (req: Request, res: Response) => {
    const storeName = req.params['name'] ?? '';

    const store = repo.stores.find((s) => s.name === storeName);
    if (!store) {
      res.status(404).json({error: `Store "${storeName}" not found`});
      return;
    }

    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- Express request body
    const payload = req.body as Record<string, unknown>;
    if (!payload || typeof payload !== 'object') {
      res.status(400).json({error: 'Request body must be a JSON object'});
      return;
    }

    // Resolve key from template
    const keyTemplate = store.entity.key;
    const key = keyTemplate.replace(/\{(\w+)\}/g, (_: string, field: string) => {
      const value = payload[field];
      if (value === undefined || value === null) {
        return field;
      }
      return String(value);
    });

    try {
      const result = await storeBackend.put(appId, storeName, key, payload, {});
      res.status(201).json(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({error: message});
    }
  });

  return router;
}
