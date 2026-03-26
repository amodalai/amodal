/**
 * @license
 * Copyright 2025 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import {describe, it, expect, vi, beforeEach} from 'vitest';
import {findRepoRoot} from './repo-discovery.js';

vi.mock('node:fs', () => ({
  existsSync: vi.fn(),
}));

describe('findRepoRoot', () => {
  let existsSync: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    const fs = await import('node:fs');
    existsSync = vi.mocked(fs.existsSync);
    existsSync.mockReset();
  });

  it('should find repo root when config is in current directory', () => {
    existsSync.mockImplementation((path: string) =>
      path === '/projects/myapp/amodal.json',
    );

    const result = findRepoRoot('/projects/myapp');
    expect(result).toBe('/projects/myapp');
  });

  it('should find repo root in parent directory', () => {
    existsSync.mockImplementation((path: string) =>
      path === '/projects/myapp/amodal.json',
    );

    const result = findRepoRoot('/projects/myapp/src/lib');
    expect(result).toBe('/projects/myapp');
  });

  it('should throw when config is not found', () => {
    existsSync.mockReturnValue(false);

    expect(() => findRepoRoot('/some/deep/path')).toThrow(
      'Could not find amodal.json',
    );
  });

  it('should handle root directory without infinite loop', () => {
    existsSync.mockReturnValue(false);

    expect(() => findRepoRoot('/')).toThrow(
      'Could not find amodal.json',
    );
  });
});
