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
  discoverInstalledPackages,
  ensureNpmContext,
  generatePackageJson,
  getNpmContextPaths,
} from './npm-context.js';
import type {LockFile} from './package-types.js';

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
    const s = await fs.stat(paths.npmDir);
    expect(s.isDirectory()).toBe(true);
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
      lockVersion: 2,
      packages: {
        '@amodalai/connection-salesforce': {
          version: '2.1.0',
          integrity: 'sha256-abc',
        },
        '@amodalai/skill-triage': {
          version: '1.0.0',
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
    const result = generatePackageJson({lockVersion: 2, packages: {}});
    expect(result['dependencies']).toEqual({});
  });
});

describe('discoverInstalledPackages', () => {
  it('discovers packages in node_modules/@amodalai', async () => {
    const paths = await ensureNpmContext(tmpDir);
    const scopeDir = path.join(paths.nodeModules, '@amodalai');

    // Create a fake installed package
    const pkgDir = path.join(scopeDir, 'connection-salesforce');
    await fs.mkdir(pkgDir, {recursive: true});
    await fs.writeFile(
      path.join(pkgDir, 'package.json'),
      JSON.stringify({name: '@amodalai/connection-salesforce', version: '2.1.0'}),
    );

    const discovered = await discoverInstalledPackages(paths);
    expect(discovered).toHaveLength(1);
    expect(discovered[0].npmName).toBe('@amodalai/connection-salesforce');
    expect(discovered[0].version).toBe('2.1.0');
    expect(discovered[0].packageDir).toBe(pkgDir);
  });

  it('returns empty array when no packages installed', async () => {
    const paths = await ensureNpmContext(tmpDir);
    const discovered = await discoverInstalledPackages(paths);
    expect(discovered).toEqual([]);
  });

  it('skips packages without version', async () => {
    const paths = await ensureNpmContext(tmpDir);
    const scopeDir = path.join(paths.nodeModules, '@amodalai');

    // Create a package dir with no package.json
    const pkgDir = path.join(scopeDir, 'broken-pkg');
    await fs.mkdir(pkgDir, {recursive: true});

    const discovered = await discoverInstalledPackages(paths);
    expect(discovered).toEqual([]);
  });
});
