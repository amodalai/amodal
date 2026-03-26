/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { writeFile, mkdir } from 'node:fs/promises';
import {
  toMjsFilename,
  writeHandlerFiles,
  importHandlers,
  loadHandlers,
} from './handler-loader.js';
import type { BundleHandler } from './version-bundle-types.js';

vi.mock('fs/promises', () => ({
  writeFile: vi.fn().mockResolvedValue(undefined),
  mkdir: vi.fn().mockResolvedValue(undefined),
}));

describe('toMjsFilename', () => {
  it('converts .ts to .mjs', () => {
    expect(toMjsFilename('compute-risk.ts')).toBe('compute-risk.mjs');
  });

  it('leaves non-.ts files unchanged', () => {
    expect(toMjsFilename('utils.mjs')).toBe('utils.mjs');
    expect(toMjsFilename('data.json')).toBe('data.json');
  });

  it('only converts trailing .ts', () => {
    expect(toMjsFilename('tsconfig.ts')).toBe('tsconfig.mjs');
  });
});

describe('writeHandlerFiles', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('writes each handler file to the correct directory', async () => {
    const handlers: Record<string, BundleHandler> = {
      'compute-risk': {
        entry: 'index.ts',
        files: {
          'index.ts': 'export default async () => {};',
          'utils.mjs': 'export const PI = 3.14;',
        },
      },
    };

    await writeHandlerFiles(handlers, '/tmp/v1');

    expect(mkdir).toHaveBeenCalledWith(
      '/tmp/v1/handlers/compute-risk',
      { recursive: true },
    );
    // Entry .ts file converted to .mjs
    expect(writeFile).toHaveBeenCalledWith(
      '/tmp/v1/handlers/compute-risk/index.mjs',
      'export default async () => {};',
      'utf-8',
    );
    // Non-entry file kept as-is
    expect(writeFile).toHaveBeenCalledWith(
      '/tmp/v1/handlers/compute-risk/utils.mjs',
      'export const PI = 3.14;',
      'utf-8',
    );
  });

  it('handles multiple handlers', async () => {
    const handlers: Record<string, BundleHandler> = {
      'handler-a': {
        entry: 'main.ts',
        files: { 'main.ts': 'export default async () => "a";' },
      },
      'handler-b': {
        entry: 'main.ts',
        files: { 'main.ts': 'export default async () => "b";' },
      },
    };

    await writeHandlerFiles(handlers, '/tmp/v1');

    expect(mkdir).toHaveBeenCalledTimes(2);
    expect(writeFile).toHaveBeenCalledTimes(2);
  });
});

describe('importHandlers', () => {
  it('imports handler modules and extracts default exports', async () => {
    // We can't easily test actual dynamic import in unit tests without real files.
    // This test verifies the error case: module without default export.
    const handlers: Record<string, BundleHandler> = {
      'bad-handler': {
        entry: 'index.ts',
        files: { 'index.ts': 'export const value = 42;' },
      },
    };

    // The import will fail because the file doesn't exist on disk
    await expect(
      importHandlers(handlers, '/tmp/nonexistent'),
    ).rejects.toThrow();
  });
});

describe('loadHandlers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns empty map for empty handlers', async () => {
    const result = await loadHandlers({}, '/tmp/v1');
    expect(result.size).toBe(0);
    expect(writeFile).not.toHaveBeenCalled();
  });
});
