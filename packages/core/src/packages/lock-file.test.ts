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
import {
  addLockEntry,
  buildLockFile,
  getLockEntry,
  listLockEntries,
  readLockFile,
  removeLockEntry,
  writeLockFile,
} from './lock-file.js';
import type {LockFile} from './package-types.js';

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'lock-test-'));
  await fs.mkdir(tmpDir, {recursive: true});
});

afterEach(async () => {
  await fs.rm(tmpDir, {recursive: true, force: true});
});

const sampleLock: LockFile = {
  lockVersion: 2,
  packages: {
    '@amodalai/connection-salesforce': {
      version: '2.1.0',
      integrity: 'sha256-abc123',
    },
    '@amodalai/skill-deal-triage': {
      version: '1.0.0',
      integrity: 'sha256-def456',
    },
  },
};

describe('readLockFile', () => {
  it('reads existing lock file', async () => {
    await fs.writeFile(
      path.join(tmpDir, 'amodal.lock'),
      JSON.stringify(sampleLock, null, 2),
    );
    const result = await readLockFile(tmpDir);
    expect(result).toEqual(sampleLock);
  });

  it('returns null for missing file', async () => {
    const result = await readLockFile(tmpDir);
    expect(result).toBeNull();
  });

  it('throws on invalid JSON', async () => {
    await fs.writeFile(path.join(tmpDir, 'amodal.lock'), 'not json');
    await expect(readLockFile(tmpDir)).rejects.toThrow(PackageError);
  });

  it('throws on schema validation failure', async () => {
    await fs.writeFile(
      path.join(tmpDir, 'amodal.lock'),
      JSON.stringify({lockVersion: 99, packages: {}}),
    );
    await expect(readLockFile(tmpDir)).rejects.toThrow(PackageError);
  });
});

describe('writeLockFile', () => {
  it('writes lock file atomically', async () => {
    await writeLockFile(tmpDir, sampleLock);
    const content = await fs.readFile(path.join(tmpDir, 'amodal.lock'), 'utf-8');
    expect(JSON.parse(content)).toEqual(sampleLock);
  });

  it('creates directory if needed', async () => {
    const newDir = path.join(tmpDir, 'sub');
    await writeLockFile(newDir, {lockVersion: 2, packages: {}});
    const result = await readLockFile(newDir);
    expect(result).toEqual({lockVersion: 2, packages: {}});
  });
});

describe('addLockEntry', () => {
  it('adds entry to existing lock file', async () => {
    await writeLockFile(tmpDir, sampleLock);
    const updated = await addLockEntry(tmpDir, '@amodalai/connection-slack', {
      version: '1.0.0',
      integrity: 'sha256-ghi789',
    });
    expect(updated.packages['@amodalai/connection-slack']).toBeDefined();
    expect(updated.packages['@amodalai/connection-salesforce']).toBeDefined();
  });

  it('creates lock file if none exists', async () => {
    const updated = await addLockEntry(tmpDir, '@amodalai/skill-triage', {
      version: '1.0.0',
      integrity: 'sha256-xyz',
    });
    expect(updated.lockVersion).toBe(2);
    expect(updated.packages['@amodalai/skill-triage']).toBeDefined();
  });

  it('updates existing entry', async () => {
    await writeLockFile(tmpDir, sampleLock);
    const updated = await addLockEntry(tmpDir, '@amodalai/connection-salesforce', {
      version: '3.0.0',
      integrity: 'sha256-new',
    });
    expect(updated.packages['@amodalai/connection-salesforce'].version).toBe('3.0.0');
  });
});

describe('removeLockEntry', () => {
  it('removes entry from lock file', async () => {
    await writeLockFile(tmpDir, sampleLock);
    const updated = await removeLockEntry(tmpDir, '@amodalai/connection-salesforce');
    expect(updated.packages['@amodalai/connection-salesforce']).toBeUndefined();
    expect(updated.packages['@amodalai/skill-deal-triage']).toBeDefined();
  });

  it('no-ops for non-existent entry', async () => {
    await writeLockFile(tmpDir, sampleLock);
    const updated = await removeLockEntry(tmpDir, '@amodalai/skill-nonexistent');
    expect(Object.keys(updated.packages)).toHaveLength(2);
  });
});

describe('getLockEntry', () => {
  it('returns entry when found', async () => {
    await writeLockFile(tmpDir, sampleLock);
    const entry = await getLockEntry(tmpDir, '@amodalai/connection-salesforce');
    expect(entry).toEqual(sampleLock.packages['@amodalai/connection-salesforce']);
  });

  it('returns null when not found', async () => {
    await writeLockFile(tmpDir, sampleLock);
    const entry = await getLockEntry(tmpDir, '@amodalai/skill-nonexistent');
    expect(entry).toBeNull();
  });

  it('returns null when no lock file', async () => {
    const entry = await getLockEntry(tmpDir, '@amodalai/connection-foo');
    expect(entry).toBeNull();
  });
});

describe('listLockEntries', () => {
  it('lists all entries', async () => {
    await writeLockFile(tmpDir, sampleLock);
    const entries = await listLockEntries(tmpDir);
    expect(entries).toHaveLength(2);
    expect(entries.map((e) => e.npmName)).toContain('@amodalai/connection-salesforce');
    expect(entries.map((e) => e.npmName)).toContain('@amodalai/skill-deal-triage');
  });

  it('returns empty array when no lock file', async () => {
    const entries = await listLockEntries(tmpDir);
    expect(entries).toEqual([]);
  });
});

describe('buildLockFile', () => {
  it('builds lock file from package list', async () => {
    const lock = await buildLockFile(tmpDir, [
      {npmName: '@amodalai/connection-salesforce', version: '2.1.0', integrity: 'sha256-abc'},
      {npmName: '@amodalai/skill-triage', version: '1.0.0', integrity: 'sha256-def'},
    ]);
    expect(lock.lockVersion).toBe(2);
    expect(lock.packages['@amodalai/connection-salesforce'].version).toBe('2.1.0');
    expect(lock.packages['@amodalai/skill-triage'].version).toBe('1.0.0');

    // Verify it was written to disk
    const read = await readLockFile(tmpDir);
    expect(read).toEqual(lock);
  });

  it('builds empty lock file', async () => {
    const lock = await buildLockFile(tmpDir, []);
    expect(lock.lockVersion).toBe(2);
    expect(Object.keys(lock.packages)).toHaveLength(0);
  });
});
