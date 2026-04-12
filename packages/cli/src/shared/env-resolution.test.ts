/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import {describe, it, expect, beforeEach, afterEach} from 'vitest';
import {mkdtempSync, writeFileSync, mkdirSync, rmSync} from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {resolveEnv} from './env-resolution.js';

describe('resolveEnv', () => {
  let tmpDir: string;
  let fakeHome: string;
  let origHome: string;
  let origEnvValue: string | undefined;
  const TEST_KEY = 'AMODAL_TEST_RESOLVE_ENV_KEY';

  beforeEach(() => {
    tmpDir = mkdtempSync(path.join(os.tmpdir(), 'env-resolution-test-'));
    fakeHome = mkdtempSync(path.join(os.tmpdir(), 'env-resolution-home-'));
    origHome = process.env['HOME'] ?? '';
    origEnvValue = process.env[TEST_KEY];
    delete process.env[TEST_KEY];
    // Override HOME so ~/.amodal/env resolves to our temp dir
    process.env['HOME'] = fakeHome;
  });

  afterEach(() => {
    process.env['HOME'] = origHome;
    if (origEnvValue !== undefined) {
      process.env[TEST_KEY] = origEnvValue;
    } else {
      delete process.env[TEST_KEY];
    }
    rmSync(tmpDir, {recursive: true, force: true});
    rmSync(fakeHome, {recursive: true, force: true});
  });

  it('resolves from agent .env file', () => {
    writeFileSync(path.join(tmpDir, '.env'), `${TEST_KEY}=agent-value\n`);
    expect(resolveEnv(TEST_KEY, tmpDir)).toBe('agent-value');
  });

  it('resolves from ~/.amodal/env', () => {
    mkdirSync(path.join(fakeHome, '.amodal'), {recursive: true});
    writeFileSync(path.join(fakeHome, '.amodal', '.env'), `${TEST_KEY}=global-value\n`);
    expect(resolveEnv(TEST_KEY, tmpDir)).toBe('global-value');
  });

  it('resolves from process.env', () => {
    process.env[TEST_KEY] = 'shell-value';
    expect(resolveEnv(TEST_KEY, tmpDir)).toBe('shell-value');
  });

  it('agent .env takes priority over global', () => {
    writeFileSync(path.join(tmpDir, '.env'), `${TEST_KEY}=agent-value\n`);
    mkdirSync(path.join(fakeHome, '.amodal'), {recursive: true});
    writeFileSync(path.join(fakeHome, '.amodal', '.env'), `${TEST_KEY}=global-value\n`);
    process.env[TEST_KEY] = 'shell-value';
    expect(resolveEnv(TEST_KEY, tmpDir)).toBe('agent-value');
  });

  it('global takes priority over process.env', () => {
    mkdirSync(path.join(fakeHome, '.amodal'), {recursive: true});
    writeFileSync(path.join(fakeHome, '.amodal', '.env'), `${TEST_KEY}=global-value\n`);
    process.env[TEST_KEY] = 'shell-value';
    expect(resolveEnv(TEST_KEY, tmpDir)).toBe('global-value');
  });

  it('returns undefined when not found anywhere', () => {
    expect(resolveEnv(TEST_KEY, tmpDir)).toBeUndefined();
  });

  it('handles comments and empty lines in .env files', () => {
    writeFileSync(
      path.join(tmpDir, '.env'),
      `# This is a comment\n\nIRRELEVANT=foo\n\n${TEST_KEY}=found-it\n# trailing comment\n`,
    );
    expect(resolveEnv(TEST_KEY, tmpDir)).toBe('found-it');
  });

  it('strips quotes from values', () => {
    writeFileSync(path.join(tmpDir, '.env'), `${TEST_KEY}="quoted-value"\n`);
    expect(resolveEnv(TEST_KEY, tmpDir)).toBe('quoted-value');
  });

  it('strips single quotes from values', () => {
    writeFileSync(path.join(tmpDir, '.env'), `${TEST_KEY}='single-quoted'\n`);
    expect(resolveEnv(TEST_KEY, tmpDir)).toBe('single-quoted');
  });
});
