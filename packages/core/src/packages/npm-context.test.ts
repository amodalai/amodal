/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';

import {
  ensureNpmContext,
  generatePackageJson,
  getPackageDir,
  getNpmContextPaths,
} from './npm-context.js';
import type {LockFile} from './package-types.js';
import {makePackageRef, toSymlinkName} from './package-types.js';

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'npm-ctx-test-'));
});

afterEach(async () => {
  vi.restoreAllMocks();
  await fs.rm(tmpDir, {recursive: true, force: true});
});

describe('getNpmContextPaths', () => {
  it('returns correct paths', () => {
    const paths = getNpmContextPaths('/repo');
    expect(paths.root).toBe('/repo/amodal_packages');
    expect(paths.npmDir).toBe('/repo/amodal_packages/.npm');
    expect(paths.npmrc).toBe('/repo/amodal_packages/.npm/.npmrc');
    expect(paths.packageJson).toBe('/repo/amodal_packages/.npm/package.json');
    expect(paths.nodeModules).toBe('/repo/amodal_packages/.npm/node_modules');
  });
});

describe('ensureNpmContext', () => {
  it('creates npm directory structure', async () => {
    const paths = await ensureNpmContext(tmpDir);
    const npmrcContent = await fs.readFile(paths.npmrc, 'utf-8');
    expect(npmrcContent).toContain('registry=https://registry.amodalai.com');

    const pkgJson = JSON.parse(await fs.readFile(paths.packageJson, 'utf-8')) as Record<string, unknown>;
    expect(pkgJson['name']).toBe('amodal-packages');
    expect(pkgJson['private']).toBe(true);
  });

  it('uses custom registry URL', async () => {
    const paths = await ensureNpmContext(tmpDir, 'https://custom.registry.com');
    const npmrcContent = await fs.readFile(paths.npmrc, 'utf-8');
    expect(npmrcContent).toContain('registry=https://custom.registry.com');
  });

  it('is idempotent', async () => {
    await ensureNpmContext(tmpDir);
    const paths = await ensureNpmContext(tmpDir);
    // Should not throw, and paths should be valid
    const stat = await fs.stat(paths.npmDir);
    expect(stat.isDirectory()).toBe(true);
  });

  it('preserves existing package.json', async () => {
    const paths = await ensureNpmContext(tmpDir);
    // Write custom content
    await fs.writeFile(paths.packageJson, '{"name": "custom", "private": true}');
    // Run again
    await ensureNpmContext(tmpDir);
    const content = await fs.readFile(paths.packageJson, 'utf-8');
    expect(content).toContain('"custom"');
  });
});

describe('generatePackageJson', () => {
  it('generates correct package.json from lock file', () => {
    const lock: LockFile = {
      lockVersion: 1,
      packages: {
        'connection/salesforce': {
          version: '2.1.0',
          npm: '@amodalai/connection-salesforce',
          integrity: 'sha256-abc',
        },
        'skill/triage': {
          version: '1.0.0',
          npm: '@amodalai/skill-triage',
          integrity: 'sha256-def',
        },
      },
    };

    const result = generatePackageJson(lock);
    expect(result).toEqual({
      name: 'amodal-packages',
      private: true,
      dependencies: {
        '@amodalai/connection-salesforce': '2.1.0',
        '@amodalai/skill-triage': '1.0.0',
      },
    });
  });

  it('handles empty lock file', () => {
    const result = generatePackageJson({lockVersion: 1, packages: {}});
    expect(result['dependencies']).toEqual({});
  });
});

describe('getPackageDir', () => {
  it('returns symlink path when it exists and is a directory', async () => {
    const ref = makePackageRef('connection', 'salesforce');
    const paths = getNpmContextPaths(tmpDir);
    await fs.mkdir(paths.root, {recursive: true});

    // Create a real directory as the target
    const targetDir = path.join(tmpDir, 'target');
    await fs.mkdir(targetDir, {recursive: true});

    const symlinkPath = path.join(paths.root, toSymlinkName('connection', 'salesforce'));
    await fs.symlink(targetDir, symlinkPath, 'dir');

    const result = await getPackageDir(tmpDir, ref);
    expect(result).toBe(symlinkPath);
  });

  it('returns null when symlink does not exist', async () => {
    const ref = makePackageRef('connection', 'salesforce');
    const result = await getPackageDir(tmpDir, ref);
    expect(result).toBeNull();
  });

  it('returns null when symlink is broken', async () => {
    const ref = makePackageRef('connection', 'salesforce');
    const paths = getNpmContextPaths(tmpDir);
    await fs.mkdir(paths.root, {recursive: true});

    const symlinkPath = path.join(paths.root, toSymlinkName('connection', 'salesforce'));
    // Create symlink to non-existent target
    await fs.symlink('/nonexistent/path', symlinkPath, 'dir');

    const result = await getPackageDir(tmpDir, ref);
    expect(result).toBeNull();
  });
});
