/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import {mkdtemp, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import * as path from 'node:path';

import {afterEach, beforeEach, describe, expect, it} from 'vitest';

import {loadPackagePermissions} from './permissions.js';

describe('loadPackagePermissions', () => {
  let pkgDir: string;

  beforeEach(async () => {
    pkgDir = await mkdtemp(path.join(tmpdir(), 'pkg-perms-'));
  });

  afterEach(async () => {
    await rm(pkgDir, {recursive: true, force: true});
  });

  async function writePkg(content: unknown): Promise<void> {
    await writeFile(path.join(pkgDir, 'package.json'), JSON.stringify(content), 'utf-8');
  }

  it('returns an empty permission list when package.json is missing', async () => {
    const result = await loadPackagePermissions(pkgDir);
    expect(result.permissions).toEqual([]);
  });

  it('returns an empty permission list when amodal block is missing', async () => {
    await writePkg({name: '@amodalai/test'});
    const result = await loadPackagePermissions(pkgDir);
    expect(result).toEqual({packageName: '@amodalai/test', permissions: []});
  });

  it('parses declared permissions', async () => {
    await writePkg({
      name: '@amodalai/agent-admin',
      amodal: {permissions: ['fs.read', 'fs.write', 'db.read', 'db.write']},
    });
    const result = await loadPackagePermissions(pkgDir);
    expect(result).toEqual({
      packageName: '@amodalai/agent-admin',
      permissions: ['fs.read', 'fs.write', 'db.read', 'db.write'],
    });
  });

  it('drops unknown permission strings', async () => {
    await writePkg({
      name: '@amodalai/sketchy',
      amodal: {permissions: ['fs.read', 'secrets.write', 'unknown']},
    });
    const result = await loadPackagePermissions(pkgDir);
    expect(result.permissions).toEqual(['fs.read']);
  });

  it('falls back to dirname when name is missing', async () => {
    await writePkg({amodal: {permissions: ['net.fetch']}});
    const result = await loadPackagePermissions(pkgDir);
    expect(result.packageName).toBe(path.basename(pkgDir));
    expect(result.permissions).toEqual(['net.fetch']);
  });

  it('returns empty on malformed JSON', async () => {
    await writeFile(path.join(pkgDir, 'package.json'), 'not json', 'utf-8');
    const result = await loadPackagePermissions(pkgDir);
    expect(result.permissions).toEqual([]);
  });
});
