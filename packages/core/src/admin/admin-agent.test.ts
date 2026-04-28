/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

/**
 * Smoke tests for versioned admin agent cache.
 *
 * These tests hit the real npm registry to fetch @amodalai/agent-admin.
 * They use a temporary directory as the home dir to avoid touching the
 * real ~/.amodal cache.
 *
 * Run:
 *   pnpm --filter @amodalai/core vitest run src/admin/admin-agent.test.ts
 */

import {describe, it, expect, beforeEach, afterEach, vi} from 'vitest';
import {mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync} from 'node:fs';
import {readdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve, join} from 'node:path';

// Mock homedir so tests use a temp directory instead of the real ~/.amodal
const fakeHome = mkdtempSync(resolve(tmpdir(), 'admin-agent-test-'));
vi.mock('node:os', async (importOriginal) => {
  const original = await importOriginal<typeof import('node:os')>();
  return {...original, homedir: () => fakeHome};
});

// Import AFTER mock is set up
const {
  getAdminCacheDir,
  getAdminAgentConfig,
  resolveAdminAgent,
  fetchAdminAgent,
  ensureAdminAgent,
  getAdminAgentVersion,
  checkRegistryVersion,
} = await import('./admin-agent.js');

// Two known published versions for testing
const VERSION_OLD = '0.1.0';
const VERSION_NEW = '0.1.1';

let tempAgentDir: string;

beforeEach(() => {
  tempAgentDir = mkdtempSync(resolve(tmpdir(), 'admin-agent-repo-'));
});

afterEach(() => {
  // Clean up temp agent dir
  rmSync(tempAgentDir, {recursive: true, force: true});
  // Clean up fake cache between tests
  const cacheBase = join(fakeHome, '.amodal', 'admin-agent');
  rmSync(cacheBase, {recursive: true, force: true});
});

describe('getAdminCacheDir', () => {
  it('returns latest slot when no version specified', () => {
    const dir = getAdminCacheDir();
    expect(dir).toContain('admin-agent');
    expect(dir).toMatch(/latest$/);
  });

  it('returns version-specific slot', () => {
    const dir = getAdminCacheDir('0.5.0');
    expect(dir).toMatch(/0\.5\.0$/);
  });
});

describe('getAdminAgentConfig', () => {
  it('returns empty config when no amodal.json', async () => {
    const config = await getAdminAgentConfig(tempAgentDir);
    expect(config).toEqual({});
  });

  it('reads adminAgent path override', async () => {
    writeFileSync(
      resolve(tempAgentDir, 'amodal.json'),
      JSON.stringify({name: 'test', version: '1.0.0', adminAgent: '/custom/path'}),
    );
    const config = await getAdminAgentConfig(tempAgentDir);
    expect(config.pathOverride).toBe('/custom/path');
    expect(config.pinnedVersion).toBeUndefined();
  });

  it('reads adminAgentVersion pin', async () => {
    writeFileSync(
      resolve(tempAgentDir, 'amodal.json'),
      JSON.stringify({name: 'test', version: '1.0.0', adminAgentVersion: '0.1.0'}),
    );
    const config = await getAdminAgentConfig(tempAgentDir);
    expect(config.pinnedVersion).toBe('0.1.0');
    expect(config.pathOverride).toBeUndefined();
  });
});

describe('fetchAdminAgent', () => {
  it('fetches latest into the latest slot', async () => {
    const dir = await fetchAdminAgent();
    expect(dir).toMatch(/latest$/);
    expect(existsSync(join(dir, 'amodal.json'))).toBe(true);
    expect(existsSync(join(dir, 'package.json'))).toBe(true);
  }, 30_000);

  it('fetches a pinned version into its own slot', async () => {
    const dir = await fetchAdminAgent({version: VERSION_OLD});
    expect(dir).toMatch(new RegExp(`${VERSION_OLD.replace(/\./g, '\\.')}$`));
    expect(existsSync(join(dir, 'package.json'))).toBe(true);
    const version = await getAdminAgentVersion(dir);
    expect(version).toBe(VERSION_OLD);
  }, 30_000);

  it('two versions coexist in separate slots', async () => {
    const dirOld = await fetchAdminAgent({version: VERSION_OLD});
    const dirNew = await fetchAdminAgent({version: VERSION_NEW});

    expect(dirOld).not.toBe(dirNew);
    expect(existsSync(join(dirOld, 'package.json'))).toBe(true);
    expect(existsSync(join(dirNew, 'package.json'))).toBe(true);

    const vOld = await getAdminAgentVersion(dirOld);
    const vNew = await getAdminAgentVersion(dirNew);
    expect(vOld).toBe(VERSION_OLD);
    expect(vNew).toBe(VERSION_NEW);

    // Both slots exist under the cache base
    const cacheBase = join(fakeHome, '.amodal', 'admin-agent');
    const slots = await readdir(cacheBase);
    expect(slots).toContain(VERSION_OLD);
    expect(slots).toContain(VERSION_NEW);
  }, 60_000);
});

describe('resolveAdminAgent', () => {
  it('returns null when nothing is cached', async () => {
    const result = await resolveAdminAgent(tempAgentDir);
    expect(result).toBeNull();
  });

  it('resolves from latest slot when no pin', async () => {
    writeFileSync(
      resolve(tempAgentDir, 'amodal.json'),
      JSON.stringify({name: 'test', version: '1.0.0'}),
    );
    await fetchAdminAgent();
    const result = await resolveAdminAgent(tempAgentDir);
    expect(result).toMatch(/latest$/);
  }, 30_000);

  it('resolves from pinned version slot', async () => {
    writeFileSync(
      resolve(tempAgentDir, 'amodal.json'),
      JSON.stringify({name: 'test', version: '1.0.0', adminAgentVersion: VERSION_OLD}),
    );
    await fetchAdminAgent({version: VERSION_OLD});
    const result = await resolveAdminAgent(tempAgentDir);
    expect(result).toMatch(new RegExp(`${VERSION_OLD.replace(/\./g, '\\.')}$`));
  }, 30_000);

  it('prefers path override over cache', async () => {
    const overrideDir = resolve(tempAgentDir, 'my-admin');
    mkdirSync(overrideDir, {recursive: true});
    writeFileSync(resolve(overrideDir, 'amodal.json'), '{}');

    writeFileSync(
      resolve(tempAgentDir, 'amodal.json'),
      JSON.stringify({name: 'test', version: '1.0.0', adminAgent: './my-admin'}),
    );

    await fetchAdminAgent(); // cache exists too
    const result = await resolveAdminAgent(tempAgentDir);
    expect(result).toBe(overrideDir);
  }, 30_000);
});

describe('ensureAdminAgent', () => {
  it('fetches on first call, reuses cache on second', async () => {
    writeFileSync(
      resolve(tempAgentDir, 'amodal.json'),
      JSON.stringify({name: 'test', version: '1.0.0'}),
    );

    const dir1 = await ensureAdminAgent(tempAgentDir);
    expect(existsSync(join(dir1, 'amodal.json'))).toBe(true);

    const dir2 = await ensureAdminAgent(tempAgentDir);
    expect(dir2).toBe(dir1);
  }, 60_000);

  it('fetches pinned version when not cached', async () => {
    writeFileSync(
      resolve(tempAgentDir, 'amodal.json'),
      JSON.stringify({name: 'test', version: '1.0.0', adminAgentVersion: VERSION_OLD}),
    );

    const dir = await ensureAdminAgent(tempAgentDir);
    const version = await getAdminAgentVersion(dir);
    expect(version).toBe(VERSION_OLD);
  }, 30_000);
});

describe('old cache migration', () => {
  it('migrates flat cache into latest/ slot', async () => {
    writeFileSync(
      resolve(tempAgentDir, 'amodal.json'),
      JSON.stringify({name: 'test', version: '1.0.0'}),
    );

    // Simulate old flat cache layout
    const cacheBase = join(fakeHome, '.amodal', 'admin-agent');
    mkdirSync(cacheBase, {recursive: true});
    writeFileSync(join(cacheBase, 'package.json'), JSON.stringify({version: '0.0.1'}));
    writeFileSync(join(cacheBase, 'amodal.json'), JSON.stringify({name: 'admin'}));
    mkdirSync(join(cacheBase, 'skills'), {recursive: true});

    const result = await resolveAdminAgent(tempAgentDir);
    expect(result).toMatch(/latest$/);
    expect(existsSync(join(result!, 'package.json'))).toBe(true);
    expect(existsSync(join(result!, 'amodal.json'))).toBe(true);
    expect(existsSync(join(result!, 'skills'))).toBe(true);
    // Old root-level files should be gone
    expect(existsSync(join(cacheBase, 'package.json'))).toBe(false);
  });

  it('nukes unrecognizable cache structure', async () => {
    writeFileSync(
      resolve(tempAgentDir, 'amodal.json'),
      JSON.stringify({name: 'test', version: '1.0.0'}),
    );

    // Create garbage in the cache dir
    const cacheBase = join(fakeHome, '.amodal', 'admin-agent');
    mkdirSync(cacheBase, {recursive: true});
    writeFileSync(join(cacheBase, 'random-junk.txt'), 'corrupted');

    const result = await resolveAdminAgent(tempAgentDir);
    expect(result).toBeNull();
    // Cache dir should be cleaned up
    expect(existsSync(cacheBase)).toBe(false);
  });
});

describe('checkRegistryVersion', () => {
  it('returns a version string from the registry', async () => {
    const version = await checkRegistryVersion();
    expect(version).toMatch(/^\d+\.\d+\.\d+/);
  }, 10_000);
});
