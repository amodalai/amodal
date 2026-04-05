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

  it('falls back to PGLite when postgresUrl is an empty string', async () => {
    // Caller is responsible for resolving env: refs; empty string is
    // what they pass when `env:VAR` was unset.
    const store = await selectSessionStore({
      backend: 'postgres',
      postgresUrl: '',
      logger,
    });
    created.push(store);
    expect(store).toBeInstanceOf(PGLiteSessionStore);
  });

  it('falls back to PGLite when Postgres connection fails to initialize', async () => {
    // Unreachable host + very short connect timeout → init throws →
    // selector logs error and falls back to PGLite. This is the
    // "runtime must boot even on misconfigured Postgres" path.
    const store = await selectSessionStore({
      backend: 'postgres',
      // Port 1 is reserved and connection will be refused fast
      postgresUrl: 'postgres://nobody:nothing@127.0.0.1:1/missing?connect_timeout=1',
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
});
