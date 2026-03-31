/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import {afterEach, beforeEach, describe, expect, it} from 'vitest';

import {PackageError} from './package-error.js';
import {listPackageFiles, readPackageFile, readPackageManifest} from './manifest-reader.js';

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'manifest-test-'));
});

afterEach(async () => {
  await fs.rm(tmpDir, {recursive: true, force: true});
});

describe('readPackageManifest', () => {
  it('reads valid connection manifest', async () => {
    await fs.writeFile(
      path.join(tmpDir, 'package.json'),
      JSON.stringify({
        name: '@amodalai/connection-salesforce',
        version: '2.1.0',
        amodal: {
          name: 'salesforce',
          tags: ['connection'],
          auth: {type: 'bearer', envVars: {TOKEN: 'desc'}},
          testEndpoints: ['GET /test'],
        },
      }),
    );
    const manifest = await readPackageManifest(tmpDir);
    expect(manifest.name).toBe('salesforce');
    expect(manifest.tags).toEqual(['connection']);
  });

  it('reads valid skill manifest', async () => {
    await fs.writeFile(
      path.join(tmpDir, 'package.json'),
      JSON.stringify({
        name: '@amodalai/skill-triage',
        amodal: {name: 'triage', tags: ['skill']},
      }),
    );
    const manifest = await readPackageManifest(tmpDir);
    expect(manifest.name).toBe('triage');
  });

  it('throws on missing package.json', async () => {
    await expect(readPackageManifest(tmpDir)).rejects.toThrow(PackageError);
  });

  it('throws on missing amodal block', async () => {
    await fs.writeFile(
      path.join(tmpDir, 'package.json'),
      JSON.stringify({name: 'test', version: '1.0.0'}),
    );
    await expect(readPackageManifest(tmpDir)).rejects.toThrow(PackageError);
  });

  it('throws on invalid manifest (missing required name)', async () => {
    await fs.writeFile(
      path.join(tmpDir, 'package.json'),
      JSON.stringify({
        name: 'test',
        amodal: {tags: ['something']},
      }),
    );
    await expect(readPackageManifest(tmpDir)).rejects.toThrow(PackageError);
  });

  it('throws on invalid JSON', async () => {
    await fs.writeFile(path.join(tmpDir, 'package.json'), 'not json');
    await expect(readPackageManifest(tmpDir)).rejects.toThrow(PackageError);
  });

  it('reads old v1 manifest with type field (backward compat)', async () => {
    await fs.writeFile(
      path.join(tmpDir, 'package.json'),
      JSON.stringify({
        name: '@amodalai/connection-stripe',
        version: '1.0.0',
        amodal: {
          type: 'connection',
          name: 'stripe',
          auth: {type: 'api_key', headers: {'Authorization': 'Bearer {{API_KEY}}'}},
          testEndpoints: ['GET /v1/customers?limit=1'],
        },
      }),
    );
    const manifest = await readPackageManifest(tmpDir);
    expect(manifest.name).toBe('stripe');
    // type field is silently stripped by zod
    expect('type' in manifest).toBe(false);
  });
});

describe('readPackageFile', () => {
  it('reads existing file', async () => {
    await fs.writeFile(path.join(tmpDir, 'surface.md'), '# Surface');
    const content = await readPackageFile(tmpDir, 'surface.md');
    expect(content).toBe('# Surface');
  });

  it('returns null for missing file', async () => {
    const content = await readPackageFile(tmpDir, 'nonexistent.md');
    expect(content).toBeNull();
  });
});

describe('listPackageFiles', () => {
  it('lists files in directory', async () => {
    await fs.writeFile(path.join(tmpDir, 'spec.json'), '{}');
    await fs.writeFile(path.join(tmpDir, 'surface.md'), '');
    await fs.mkdir(path.join(tmpDir, 'subdir'));
    const files = await listPackageFiles(tmpDir);
    expect(files).toContain('spec.json');
    expect(files).toContain('surface.md');
    expect(files).not.toContain('subdir');
  });

  it('returns empty array for nonexistent directory', async () => {
    const files = await listPackageFiles(path.join(tmpDir, 'nope'));
    expect(files).toEqual([]);
  });
});
