/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import {mkdtempSync, writeFileSync, rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {describe, it, expect, beforeEach, afterEach} from 'vitest';
import {loadEnvFile} from './load-env.js';

describe('loadEnvFile', () => {
  let tempDir: string;
  const savedEnv: Record<string, string | undefined> = {};

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'env-test-'));
  });

  afterEach(() => {
    rmSync(tempDir, {recursive: true, force: true});
    for (const key of Object.keys(savedEnv)) {
      if (savedEnv[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = savedEnv[key];
      }
    }
  });

  function trackEnv(key: string) {
    savedEnv[key] = process.env[key];
  }

  it('should load simple KEY=value pairs', () => {
    writeFileSync(join(tempDir, '.env'), 'TEST_LOAD_A=hello\nTEST_LOAD_B=world\n');
    trackEnv('TEST_LOAD_A');
    trackEnv('TEST_LOAD_B');

    loadEnvFile(tempDir);

    expect(process.env['TEST_LOAD_A']).toBe('hello');
    expect(process.env['TEST_LOAD_B']).toBe('world');
  });

  it('should handle export prefix', () => {
    writeFileSync(join(tempDir, '.env'), 'export TEST_LOAD_C=exported\n');
    trackEnv('TEST_LOAD_C');

    loadEnvFile(tempDir);

    expect(process.env['TEST_LOAD_C']).toBe('exported');
  });

  it('should strip quotes', () => {
    writeFileSync(join(tempDir, '.env'), 'TEST_LOAD_D="double"\nTEST_LOAD_E=\'single\'\n');
    trackEnv('TEST_LOAD_D');
    trackEnv('TEST_LOAD_E');

    loadEnvFile(tempDir);

    expect(process.env['TEST_LOAD_D']).toBe('double');
    expect(process.env['TEST_LOAD_E']).toBe('single');
  });

  it('should skip comments and blank lines', () => {
    writeFileSync(join(tempDir, '.env'), '# comment\n\nTEST_LOAD_F=value\n  \n');
    trackEnv('TEST_LOAD_F');

    loadEnvFile(tempDir);

    expect(process.env['TEST_LOAD_F']).toBe('value');
  });

  it('should not override existing env vars', () => {
    writeFileSync(join(tempDir, '.env'), 'TEST_LOAD_G=from-file\n');
    trackEnv('TEST_LOAD_G');
    process.env['TEST_LOAD_G'] = 'already-set';

    loadEnvFile(tempDir);

    expect(process.env['TEST_LOAD_G']).toBe('already-set');
  });

  it('should do nothing if .env does not exist', () => {
    expect(() => loadEnvFile(tempDir)).not.toThrow();
  });
});
