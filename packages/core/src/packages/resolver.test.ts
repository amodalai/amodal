/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import {afterEach, beforeEach, describe, expect, it} from 'vitest';

import {resolveAllPackages} from './resolver.js';
import type {LockFile} from './package-types.js';
import {getNpmContextPaths} from './npm-context.js';

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'resolver-test-'));
});

afterEach(async () => {
  await fs.rm(tmpDir, {recursive: true, force: true});
});

// --- Helpers ---

async function writeRepoFiles(
  repoPath: string,
  subdir: string,
  name: string,
  files: Record<string, string>,
): Promise<void> {
  const dir = path.join(repoPath, subdir, name);
  await fs.mkdir(dir, {recursive: true});
  for (const [fname, content] of Object.entries(files)) {
    await fs.writeFile(path.join(dir, fname), content);
  }
}

/**
 * Set up a package in node_modules/@amodalai/ (the new directory structure).
 * The package contains subdirectories matching the content type (connections/, skills/, etc.).
 */
async function setupPackage(
  repoPath: string,
  npmShortName: string,
  contentType: string,
  contentName: string,
  files: Record<string, string>,
): Promise<void> {
  const paths = getNpmContextPaths(repoPath);
  const npmPkgDir = path.join(paths.nodeModules, '@amodalai', npmShortName, contentType, contentName);
  await fs.mkdir(npmPkgDir, {recursive: true});
  for (const [fname, content] of Object.entries(files)) {
    await fs.writeFile(path.join(npmPkgDir, fname), content);
  }
}

function makeSpec(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    baseUrl: 'https://api.example.com',
    specUrl: 'https://api.example.com/openapi.json',
    format: 'openapi',
    ...overrides,
  });
}

function makeAccess(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    endpoints: {'GET /test': {returns: ['entity']}},
    ...overrides,
  });
}

// --- resolveAllPackages ---

describe('resolveAllPackages', () => {
  it('resolves packages from lock file (zero-config)', async () => {
    const lock: LockFile = {
      lockVersion: 2,
      packages: {
        '@amodalai/connection-salesforce': {
          version: '2.1.0',
          integrity: 'sha256-abc',
        },
      },
    };

    await setupPackage(tmpDir, 'connection-salesforce', 'connections', 'salesforce', {
      'spec.json': makeSpec(),
      'access.json': makeAccess(),
    });

    const result = await resolveAllPackages({repoPath: tmpDir, lockFile: lock});
    expect(result.connections.size).toBe(1);
    expect(result.connections.has('salesforce')).toBe(true);
  });

  it('resolves hand-written repo items with no lock file', async () => {
    await writeRepoFiles(tmpDir, 'connections', 'internal', {
      'spec.json': makeSpec({specUrl: 'internal'}),
      'access.json': makeAccess(),
    });

    const result = await resolveAllPackages({repoPath: tmpDir, lockFile: null});
    expect(result.connections.size).toBe(1);
    expect(result.connections.get('internal')!.spec.specUrl).toBe('internal');
  });

  it('resolves mixed packages and hand-written', async () => {
    const lock: LockFile = {
      lockVersion: 2,
      packages: {
        '@amodalai/connection-salesforce': {
          version: '2.1.0',
          integrity: 'sha256-abc',
        },
      },
    };

    await setupPackage(tmpDir, 'connection-salesforce', 'connections', 'salesforce', {
      'spec.json': makeSpec(),
      'access.json': makeAccess(),
    });

    await writeRepoFiles(tmpDir, 'connections', 'internal', {
      'spec.json': makeSpec({specUrl: 'internal'}),
      'access.json': makeAccess(),
    });

    const result = await resolveAllPackages({repoPath: tmpDir, lockFile: lock});
    expect(result.connections.size).toBe(2);
  });

  it('handles empty lock file', async () => {
    const result = await resolveAllPackages({
      repoPath: tmpDir,
      lockFile: {lockVersion: 2, packages: {}},
    });
    expect(result.connections.size).toBe(0);
    expect(result.skills).toHaveLength(0);
  });

  it('resolves skills from packages', async () => {
    const lock: LockFile = {
      lockVersion: 2,
      packages: {
        '@amodalai/skill-triage': {
          version: '1.0.0',
          integrity: 'sha256-def',
        },
      },
    };

    await setupPackage(tmpDir, 'skill-triage', 'skills', 'triage', {
      'SKILL.md': '# Skill: Triage\nTriage methodology.\n\n## Steps\n1. Assess.',
    });

    const result = await resolveAllPackages({repoPath: tmpDir, lockFile: lock});
    expect(result.skills).toHaveLength(1);
    expect(result.skills[0].name).toBe('Triage');
  });

  it('local repo wins over packages for same name', async () => {
    const lock: LockFile = {
      lockVersion: 2,
      packages: {
        '@amodalai/connection-salesforce': {
          version: '2.1.0',
          integrity: 'sha256-abc',
        },
      },
    };

    // Package version
    await setupPackage(tmpDir, 'connection-salesforce', 'connections', 'salesforce', {
      'spec.json': makeSpec({specUrl: 'package-source'}),
      'access.json': makeAccess(),
    });

    // Local repo version (should win)
    await writeRepoFiles(tmpDir, 'connections', 'salesforce', {
      'spec.json': makeSpec({specUrl: 'local-source'}),
      'access.json': makeAccess(),
    });

    const result = await resolveAllPackages({repoPath: tmpDir, lockFile: lock});
    expect(result.connections.size).toBe(1);
    expect(result.connections.get('salesforce')!.spec.specUrl).toBe('local-source');
  });

  it('skips packages not in lock file', async () => {
    const lock: LockFile = {
      lockVersion: 2,
      packages: {
        '@amodalai/connection-salesforce': {
          version: '2.1.0',
          integrity: 'sha256-abc',
        },
      },
    };

    // This package is in node_modules but NOT in the lock file
    await setupPackage(tmpDir, 'connection-unlocked', 'connections', 'unlocked', {
      'spec.json': makeSpec(),
      'access.json': makeAccess(),
    });

    // This package IS in the lock file
    await setupPackage(tmpDir, 'connection-salesforce', 'connections', 'salesforce', {
      'spec.json': makeSpec(),
      'access.json': makeAccess(),
    });

    const result = await resolveAllPackages({repoPath: tmpDir, lockFile: lock});
    expect(result.connections.size).toBe(1);
    expect(result.connections.has('salesforce')).toBe(true);
    expect(result.connections.has('unlocked')).toBe(false);
  });

  it('returns warnings array', async () => {
    const result = await resolveAllPackages({repoPath: tmpDir, lockFile: null});
    expect(result.warnings).toBeDefined();
    expect(Array.isArray(result.warnings)).toBe(true);
  });

  it('resolves knowledge from packages', async () => {
    const lock: LockFile = {
      lockVersion: 2,
      packages: {
        '@amodalai/alert-enrichment': {
          version: '1.0.0',
          integrity: 'sha256-abc',
        },
      },
    };

    const paths = getNpmContextPaths(tmpDir);
    const kbDir = path.join(paths.nodeModules, '@amodalai', 'alert-enrichment', 'knowledge');
    await fs.mkdir(kbDir, {recursive: true});
    await fs.writeFile(
      path.join(kbDir, 'guide.md'),
      '# Knowledge: Alert Guide\n\nHow to handle alerts.',
    );

    const result = await resolveAllPackages({repoPath: tmpDir, lockFile: lock});
    expect(result.knowledge).toHaveLength(1);
    expect(result.knowledge[0].title).toBe('Alert Guide');
  });
});
