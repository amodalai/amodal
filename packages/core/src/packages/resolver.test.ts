/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import {afterEach, beforeEach, describe, expect, it} from 'vitest';

import {
  resolveAllPackages,
  resolveAutomation,
  resolveConnection,
  resolveKnowledge,
  resolveSkill,
} from './resolver.js';
import type {LockFile} from './package-types.js';
import {getNpmContextPaths} from './npm-context.js';
import {toSymlinkName} from './package-types.js';

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'resolver-test-'));
});

afterEach(async () => {
  await fs.rm(tmpDir, {recursive: true, force: true});
});

// --- Helpers ---

async function writePackageFiles(
  packageDir: string,
  files: Record<string, string>,
): Promise<void> {
  await fs.mkdir(packageDir, {recursive: true});
  for (const [name, content] of Object.entries(files)) {
    await fs.writeFile(path.join(packageDir, name), content);
  }
}

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

// --- resolveConnection ---

describe('resolveConnection', () => {
  it('returns null when neither repo nor package exists', async () => {
    const result = await resolveConnection('test', null, null);
    expect(result).toBeNull();
  });

  it('loads from package only (zero-config)', async () => {
    const pkgDir = path.join(tmpDir, 'pkg');
    await writePackageFiles(pkgDir, {
      'spec.json': makeSpec(),
      'access.json': makeAccess(),
    });
    const result = await resolveConnection('test', null, pkgDir);
    expect(result).not.toBeNull();
    expect(result!.name).toBe('test');
    expect(result!.spec.specUrl).toBe('https://api.example.com/openapi.json');
  });

  it('loads from repo only (hand-written)', async () => {
    const repoDir = path.join(tmpDir, 'repo', 'connections', 'test');
    await writePackageFiles(repoDir, {
      'spec.json': makeSpec({specUrl: 'custom'}),
      'access.json': makeAccess(),
    });
    const result = await resolveConnection('test', repoDir, null);
    expect(result).not.toBeNull();
    expect(result!.spec.specUrl).toBe('custom');
  });

  it('merges repo with import header on top of package', async () => {
    const pkgDir = path.join(tmpDir, 'pkg');
    await writePackageFiles(pkgDir, {
      'spec.json': makeSpec(),
      'access.json': makeAccess(),
      'surface.md': '## Included\n### GET /foo\nBase description.',
    });

    const repoDir = path.join(tmpDir, 'repo');
    await writePackageFiles(repoDir, {
      'spec.json': JSON.stringify({import: 'test', auth: {type: 'bearer', token: 'env:T'}}),
      'surface.md': '---\nimport: test\nonly:\n  - GET /foo\n---\n\n### GET /foo\nLocal addition.',
    });

    const result = await resolveConnection('test', repoDir, pkgDir);
    expect(result).not.toBeNull();
    expect(result!.spec.auth).toEqual({type: 'bearer', token: 'env:T'});
    expect(result!.spec.specUrl).toBe('https://api.example.com/openapi.json');
    // Surface should contain both base and local
    expect(result!.surface.length).toBeGreaterThan(0);
  });

  it('uses repo file as-is when no import header', async () => {
    const pkgDir = path.join(tmpDir, 'pkg');
    await writePackageFiles(pkgDir, {
      'spec.json': makeSpec({specUrl: 'package-source'}),
      'access.json': makeAccess(),
    });

    const repoDir = path.join(tmpDir, 'repo');
    await writePackageFiles(repoDir, {
      'spec.json': makeSpec({specUrl: 'repo-source'}),
    });

    const result = await resolveConnection('test', repoDir, pkgDir);
    expect(result).not.toBeNull();
    expect(result!.spec.specUrl).toBe('repo-source');
  });
});

// --- resolveSkill ---

describe('resolveSkill', () => {
  it('returns null when neither exists', async () => {
    expect(await resolveSkill('test', null, null)).toBeNull();
  });

  it('loads from package only', async () => {
    const pkgDir = path.join(tmpDir, 'pkg');
    await writePackageFiles(pkgDir, {
      'SKILL.md': '# Skill: Test\nA test skill.\n\n## Methodology\nDo things.',
    });
    const result = await resolveSkill('test', null, pkgDir);
    expect(result).not.toBeNull();
    expect(result!.name).toBe('Test');
  });

  it('merges with concatenation when import header present', async () => {
    const pkgDir = path.join(tmpDir, 'pkg');
    await writePackageFiles(pkgDir, {
      'SKILL.md': '# Skill: Test\nBase skill.\n\n## Methodology\nBase steps.',
    });
    const repoDir = path.join(tmpDir, 'repo');
    await writePackageFiles(repoDir, {
      'SKILL.md': '---\nimport: test\n---\nOur custom addition.',
    });
    const result = await resolveSkill('test', repoDir, pkgDir);
    expect(result).not.toBeNull();
    // Concatenation means base + local
    expect(result!.body).toContain('Base steps.');
  });
});

// --- resolveAutomation ---

describe('resolveAutomation', () => {
  it('returns null when neither exists', async () => {
    expect(await resolveAutomation('daily', null, null)).toBeNull();
  });

  it('loads from package only', async () => {
    const pkgDir = path.join(tmpDir, 'pkg');
    await writePackageFiles(pkgDir, {
      'daily.md': '# Automation: Daily Scan\nSchedule: 0 8 * * *\n\n## Check\nScan systems.\n\n## Output\nSummary.\n\n## Delivery\nSlack.',
    });
    const result = await resolveAutomation('daily', null, pkgDir);
    expect(result).not.toBeNull();
    expect(result!.title).toBe('Daily Scan');
  });
});

// --- resolveKnowledge ---

describe('resolveKnowledge', () => {
  it('returns null when neither exists', async () => {
    expect(await resolveKnowledge('guide', null, null)).toBeNull();
  });

  it('loads from package only', async () => {
    const pkgDir = path.join(tmpDir, 'pkg');
    await writePackageFiles(pkgDir, {
      'guide.md': '# Knowledge: Sales Guide\n\nContent here.',
    });
    const result = await resolveKnowledge('guide', null, pkgDir);
    expect(result).not.toBeNull();
    expect(result!.title).toBe('Sales Guide');
  });
});

// --- resolveAllPackages ---

describe('resolveAllPackages', () => {
  async function setupPackage(
    repoPath: string,
    type: string,
    name: string,
    files: Record<string, string>,
  ): Promise<void> {
    const paths = getNpmContextPaths(repoPath);
    const npmPkgDir = path.join(paths.nodeModules, `@amodalai/${type}-${name}`);
    await fs.mkdir(npmPkgDir, {recursive: true});
    for (const [fname, content] of Object.entries(files)) {
      await fs.writeFile(path.join(npmPkgDir, fname), content);
    }
    // Create symlink
    const symlinkDir = path.join(paths.root, toSymlinkName(type as 'connection', name));
    try {
      await fs.symlink(npmPkgDir, symlinkDir, 'dir');
    } catch {
      // May exist
    }
  }

  it('resolves packages from lock file (zero-config)', async () => {
    const lock: LockFile = {
      lockVersion: 1,
      packages: {
        'connection/salesforce': {
          version: '2.1.0',
          npm: '@amodalai/connection-salesforce',
          integrity: 'sha256-abc',
        },
      },
    };

    await setupPackage(tmpDir, 'connection', 'salesforce', {
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
      lockVersion: 1,
      packages: {
        'connection/salesforce': {
          version: '2.1.0',
          npm: '@amodalai/connection-salesforce',
          integrity: 'sha256-abc',
        },
      },
    };

    await setupPackage(tmpDir, 'connection', 'salesforce', {
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

  it('warns about broken symlinks', async () => {
    const lock: LockFile = {
      lockVersion: 1,
      packages: {
        'connection/broken': {
          version: '1.0.0',
          npm: '@amodalai/connection-broken',
          integrity: 'sha256-xxx',
        },
      },
    };

    // Don't create the symlink — it's in the lock file but not installed
    const result = await resolveAllPackages({repoPath: tmpDir, lockFile: lock});
    expect(result.warnings.length).toBeGreaterThan(0);
    expect(result.warnings[0]).toContain('broken');
  });

  it('handles empty lock file', async () => {
    const result = await resolveAllPackages({
      repoPath: tmpDir,
      lockFile: {lockVersion: 1, packages: {}},
    });
    expect(result.connections.size).toBe(0);
    expect(result.skills).toHaveLength(0);
  });

  it('resolves skills from lock file', async () => {
    const lock: LockFile = {
      lockVersion: 1,
      packages: {
        'skill/triage': {
          version: '1.0.0',
          npm: '@amodalai/skill-triage',
          integrity: 'sha256-def',
        },
      },
    };

    await setupPackage(tmpDir, 'skill', 'triage', {
      'SKILL.md': '# Skill: Triage\nTriage methodology.\n\n## Steps\n1. Assess.',
    });

    const result = await resolveAllPackages({repoPath: tmpDir, lockFile: lock});
    expect(result.skills).toHaveLength(1);
    expect(result.skills[0].name).toBe('Triage');
  });
});
