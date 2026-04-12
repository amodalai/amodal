/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import {describe, it, expect, afterEach} from 'vitest';
import {selectSessionStore} from './session-store-selector.js';
import {DrizzleSessionStore} from './drizzle-session-store.js';
import {createLogger} from '../logger.js';

const logger = createLogger({component: 'test:selector'});

const skip = !process.env['DATABASE_URL'];

describe.skipIf(skip)('selectSessionStore', () => {
  const created: Array<{close: () => Promise<void>}> = [];

  afterEach(async () => {
    while (created.length > 0) {
      const s = created.pop()!;
      await s.close();
    }
  });

  it('returns a Postgres-backed session store', async () => {
    const store = await selectSessionStore({logger});
    created.push(store);
    expect(store).toBeInstanceOf(DrizzleSessionStore);
    expect((store as DrizzleSessionStore).backendName).toBe('postgres');
  });
});
