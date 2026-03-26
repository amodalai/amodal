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
          type: 'connection',
          name: 'salesforce',
          auth: {type: 'bearer', envVars: {TOKEN: 'desc'}},
          testEndpoints: ['GET /test'],
        },
      }),
    );
    const manifest = await readPackageManifest(tmpDir);
    expect(manifest.type).toBe('connection');
    expect(manifest.name).toBe('salesforce');
  });

  it('reads valid skill manifest', async () => {
    await fs.writeFile(
      path.join(tmpDir, 'package.json'),
      JSON.stringify({
        name: '@amodalai/skill-triage',
        amodal: {type: 'skill', name: 'triage', requiredEntities: ['opportunity']},
      }),
    );
    const manifest = await readPackageManifest(tmpDir);
    expect(manifest.type).toBe('skill');
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

  it('throws on invalid manifest', async () => {
    await fs.writeFile(
      path.join(tmpDir, 'package.json'),
      JSON.stringify({
        name: 'test',
        amodal: {type: 'invalid_type', name: 'x'},
      }),
    );
    await expect(readPackageManifest(tmpDir)).rejects.toThrow(PackageError);
  });

  it('throws on invalid JSON', async () => {
    await fs.writeFile(path.join(tmpDir, 'package.json'), 'not json');
    await expect(readPackageManifest(tmpDir)).rejects.toThrow(PackageError);
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
