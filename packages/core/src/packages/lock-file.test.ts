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
  lockVersion: 1,
  packages: {
    'connection/salesforce': {
      version: '2.1.0',
      npm: '@amodalai/connection-salesforce',
      integrity: 'sha256-abc123',
    },
    'skill/deal-triage': {
      version: '1.0.0',
      npm: '@amodalai/skill-deal-triage',
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
    await writeLockFile(newDir, {lockVersion: 1, packages: {}});
    const result = await readLockFile(newDir);
    expect(result).toEqual({lockVersion: 1, packages: {}});
  });
});

describe('addLockEntry', () => {
  it('adds entry to existing lock file', async () => {
    await writeLockFile(tmpDir, sampleLock);
    const updated = await addLockEntry(tmpDir, 'connection', 'slack', {
      version: '1.0.0',
      npm: '@amodalai/connection-slack',
      integrity: 'sha256-ghi789',
    });
    expect(updated.packages['connection/slack']).toBeDefined();
    expect(updated.packages['connection/salesforce']).toBeDefined();
  });

  it('creates lock file if none exists', async () => {
    const updated = await addLockEntry(tmpDir, 'skill', 'triage', {
      version: '1.0.0',
      npm: '@amodalai/skill-triage',
      integrity: 'sha256-xyz',
    });
    expect(updated.lockVersion).toBe(1);
    expect(updated.packages['skill/triage']).toBeDefined();
  });

  it('updates existing entry', async () => {
    await writeLockFile(tmpDir, sampleLock);
    const updated = await addLockEntry(tmpDir, 'connection', 'salesforce', {
      version: '3.0.0',
      npm: '@amodalai/connection-salesforce',
      integrity: 'sha256-new',
    });
    expect(updated.packages['connection/salesforce'].version).toBe('3.0.0');
  });
});

describe('removeLockEntry', () => {
  it('removes entry from lock file', async () => {
    await writeLockFile(tmpDir, sampleLock);
    const updated = await removeLockEntry(tmpDir, 'connection', 'salesforce');
    expect(updated.packages['connection/salesforce']).toBeUndefined();
    expect(updated.packages['skill/deal-triage']).toBeDefined();
  });

  it('no-ops for non-existent entry', async () => {
    await writeLockFile(tmpDir, sampleLock);
    const updated = await removeLockEntry(tmpDir, 'skill', 'nonexistent');
    expect(Object.keys(updated.packages)).toHaveLength(2);
  });
});

describe('getLockEntry', () => {
  it('returns entry when found', async () => {
    await writeLockFile(tmpDir, sampleLock);
    const entry = await getLockEntry(tmpDir, 'connection', 'salesforce');
    expect(entry).toEqual(sampleLock.packages['connection/salesforce']);
  });

  it('returns null when not found', async () => {
    await writeLockFile(tmpDir, sampleLock);
    const entry = await getLockEntry(tmpDir, 'skill', 'nonexistent');
    expect(entry).toBeNull();
  });

  it('returns null when no lock file', async () => {
    const entry = await getLockEntry(tmpDir, 'connection', 'foo');
    expect(entry).toBeNull();
  });
});

describe('listLockEntries', () => {
  it('lists all entries', async () => {
    await writeLockFile(tmpDir, sampleLock);
    const entries = await listLockEntries(tmpDir);
    expect(entries).toHaveLength(2);
  });

  it('filters by type', async () => {
    await writeLockFile(tmpDir, sampleLock);
    const entries = await listLockEntries(tmpDir, 'connection');
    expect(entries).toHaveLength(1);
    expect(entries[0].name).toBe('salesforce');
  });

  it('returns empty array when no lock file', async () => {
    const entries = await listLockEntries(tmpDir);
    expect(entries).toEqual([]);
  });

  it('returns empty array when no matching type', async () => {
    await writeLockFile(tmpDir, sampleLock);
    const entries = await listLockEntries(tmpDir, 'automation');
    expect(entries).toEqual([]);
  });
});
