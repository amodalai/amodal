/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import {describe, it, expect, afterEach} from 'vitest';
import {selectSessionStore} from './session-store-selector.js';
import {PGLiteSessionStore} from './store.js';
import {PostgresSessionStore} from './postgres-store.js';
import {createLogger} from '../logger.js';

const logger = createLogger({component: 'test:selector'});

describe('selectSessionStore', () => {
  const created: Array<{close: () => Promise<void>}> = [];

  afterEach(async () => {
    while (created.length > 0) {
      const s = created.pop()!;
      await s.close();
    }
  });

  it('defaults to PGLite when no backend specified', async () => {
    const store = await selectSessionStore({logger});
    created.push(store);
    expect(store).toBeInstanceOf(PGLiteSessionStore);
  });

  it('uses PGLite when backend is explicitly pglite', async () => {
    const store = await selectSessionStore({backend: 'pglite', logger});
    created.push(store);
    expect(store).toBeInstanceOf(PGLiteSessionStore);
  });

  it('falls back to PGLite when backend=postgres but no URL is set', async () => {
    const store = await selectSessionStore({backend: 'postgres', logger});
    created.push(store);
    expect(store).toBeInstanceOf(PGLiteSessionStore);
  });

  it('falls back to PGLite when env: var is not set', async () => {
    delete process.env['DEFINITELY_NOT_SET_VAR'];
    const store = await selectSessionStore({
      backend: 'postgres',
      postgresUrl: 'env:DEFINITELY_NOT_SET_VAR',
      logger,
    });
    created.push(store);
    expect(store).toBeInstanceOf(PGLiteSessionStore);
  });

  const pgUrl = process.env['TEST_POSTGRES_URL'] ?? '';
  const itPg = pgUrl ? it : it.skip;

  itPg('uses PostgresSessionStore when backend=postgres and URL is set', async () => {
    const store = await selectSessionStore({
      backend: 'postgres',
      postgresUrl: pgUrl,
      logger,
    });
    created.push(store);
    expect(store).toBeInstanceOf(PostgresSessionStore);
  });

  itPg('resolves env: prefix and uses PostgresSessionStore', async () => {
    process.env['TEST_SELECTOR_PG_URL'] = pgUrl;
    try {
      const store = await selectSessionStore({
        backend: 'postgres',
        postgresUrl: 'env:TEST_SELECTOR_PG_URL',
        logger,
      });
      created.push(store);
      expect(store).toBeInstanceOf(PostgresSessionStore);
    } finally {
      delete process.env['TEST_SELECTOR_PG_URL'];
    }
  });
});
