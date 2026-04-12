/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import { describe, it, expect, vi } from 'vitest';
import { ensureSchema, DDL_STATEMENTS } from '../migrate.js';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

describe('ensureSchema', () => {
  it('DDL_STATEMENTS contains statements for all tables', () => {
    // We expect CREATE TABLE statements for all 10 tables plus their indexes
    expect(DDL_STATEMENTS.length).toBeGreaterThanOrEqual(10);
  });

  it('calls db.execute for every DDL statement', async () => {
    const execute = vi.fn().mockResolvedValue(undefined);
    const db = {execute} as unknown as NodePgDatabase;

    await ensureSchema(db);

    expect(execute).toHaveBeenCalledTimes(DDL_STATEMENTS.length);
  });
});
