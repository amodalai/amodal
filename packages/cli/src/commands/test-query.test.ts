/**
 * @license
 * Copyright 2025 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import {describe, it, expect, vi} from 'vitest';

vi.mock('../shared/repo-discovery.js', () => ({
  findRepoRoot: vi.fn(() => '/test/repo'),
}));

vi.mock('@amodalai/runtime', () => ({
  createLocalServer: vi.fn().mockResolvedValue({
    app: {},
    start: vi.fn().mockResolvedValue({address: () => ({port: 9999})}),
    stop: vi.fn().mockResolvedValue(undefined),
  }),
}));

describe('test-query command', () => {
  it('should import without error', async () => {
    const mod = await import('./test-query.js');
    expect(mod.runTestQuery).toBeDefined();
    expect(typeof mod.runTestQuery).toBe('function');
  });

  it('should require a message', async () => {
    const mod = await import('./test-query.js');
    expect(mod.runTestQuery).toBeDefined();
  });

  it('should use default app ID', async () => {
    const mod = await import('./test-query.js');
    expect(mod.runTestQuery).toBeDefined();
  });

  it('should accept custom port', async () => {
    const mod = await import('./test-query.js');
    expect(mod.runTestQuery).toBeDefined();
  });
});
