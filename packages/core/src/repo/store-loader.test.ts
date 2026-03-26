/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import {describe, it, expect, vi, beforeEach} from 'vitest';
import {parseStoreJson, loadStores} from './store-loader.js';
import {RepoError} from './repo-types.js';

// Mock fs
vi.mock('node:fs/promises', () => ({
  readFile: vi.fn(),
  readdir: vi.fn(),
}));

import {readFile, readdir} from 'node:fs/promises';

const mockReadFile = vi.mocked(readFile);
const mockReaddir = vi.mocked(readdir);

describe('parseStoreJson', () => {
  const minimalStore = JSON.stringify({
    entity: {
      name: 'DealHealth',
      key: '{dealId}',
      schema: {
        dealId: {type: 'string'},
        score: {type: 'number', min: 0, max: 100},
      },
    },
  });

  it('parses a minimal store and derives name from filename', () => {
    const result = parseStoreJson(minimalStore, 'deal-health.json', '/repo/stores/deal-health.json');
    expect(result.name).toBe('deal-health');
    expect(result.entity.name).toBe('DealHealth');
    expect(result.location).toBe('/repo/stores/deal-health.json');
  });

  it('uses explicit name from JSON', () => {
    const json = JSON.stringify({
      name: 'deal-health',
      entity: {
        name: 'DealHealth',
        key: '{dealId}',
        schema: {dealId: {type: 'string'}},
      },
    });
    const result = parseStoreJson(json, 'deal-health.json', '/repo/stores/deal-health.json');
    expect(result.name).toBe('deal-health');
  });

  it('throws on mismatched name vs filename', () => {
    const json = JSON.stringify({
      name: 'other-name',
      entity: {
        name: 'DealHealth',
        key: '{dealId}',
        schema: {dealId: {type: 'string'}},
      },
    });
    expect(() => parseStoreJson(json, 'deal-health.json', '/repo/stores/deal-health.json'))
      .toThrow(RepoError);
  });

  it('throws on invalid JSON', () => {
    expect(() => parseStoreJson('not json', 'bad.json', '/repo/stores/bad.json'))
      .toThrow(RepoError);
  });

  it('throws on invalid schema (missing entity)', () => {
    expect(() => parseStoreJson('{}', 'bad.json', '/repo/stores/bad.json'))
      .toThrow(RepoError);
  });

  it('throws on invalid filename as store name', () => {
    const json = JSON.stringify({
      entity: {
        name: 'X',
        key: '{id}',
        schema: {id: {type: 'string'}},
      },
    });
    expect(() => parseStoreJson(json, 'BadName.json', '/repo/stores/BadName.json'))
      .toThrow(RepoError);
  });

  it('parses TTL config', () => {
    const json = JSON.stringify({
      entity: {name: 'X', key: '{id}', schema: {id: {type: 'string'}}},
      ttl: {default: 3600, override: [{condition: "status = 'active'", ttl: 300}]},
    });
    const result = parseStoreJson(json, 'test-store.json', '/repo/stores/test-store.json');
    expect(result.ttl).toEqual({default: 3600, override: [{condition: "status = 'active'", ttl: 300}]});
  });

  it('parses failure config', () => {
    const json = JSON.stringify({
      entity: {name: 'X', key: '{id}', schema: {id: {type: 'string'}}},
      failure: {mode: 'partial', retries: 2, deadLetter: true},
    });
    const result = parseStoreJson(json, 'test-store.json', '/repo/stores/test-store.json');
    expect(result.failure?.mode).toBe('partial');
  });
});

describe('loadStores', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns empty array when stores/ does not exist', async () => {
    mockReaddir.mockRejectedValue(new Error('ENOENT'));
    const result = await loadStores('/repo');
    expect(result).toEqual([]);
  });

  it('loads a single store', async () => {
    mockReaddir.mockResolvedValue([
      {name: 'deal-health.json', isFile: () => true, isDirectory: () => false},
    ] as unknown as Awaited<ReturnType<typeof readdir>>);

    mockReadFile.mockResolvedValue(JSON.stringify({
      entity: {
        name: 'DealHealth',
        key: '{dealId}',
        schema: {dealId: {type: 'string'}},
      },
    }));

    const result = await loadStores('/repo');
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('deal-health');
  });

  it('loads multiple stores', async () => {
    mockReaddir.mockResolvedValue([
      {name: 'alerts.json', isFile: () => true, isDirectory: () => false},
      {name: 'deals.json', isFile: () => true, isDirectory: () => false},
    ] as unknown as Awaited<ReturnType<typeof readdir>>);

    mockReadFile.mockImplementation(async (filePath) => {
      const name = String(filePath).includes('alerts') ? 'Alert' : 'Deal';
      return JSON.stringify({
        entity: {name, key: '{id}', schema: {id: {type: 'string'}}},
      });
    });

    const result = await loadStores('/repo');
    expect(result).toHaveLength(2);
  });

  it('throws on duplicate store names', async () => {
    // Two files that both derive the same store name (no explicit name field)
    // We simulate this by having two files with the same content but no name field,
    // and returning the same derived name from both filenames.
    mockReaddir.mockResolvedValue([
      {name: 'alerts.json', isFile: () => true, isDirectory: () => false},
      {name: 'alerts.json', isFile: () => true, isDirectory: () => false},
    ] as unknown as Awaited<ReturnType<typeof readdir>>);

    mockReadFile.mockResolvedValue(JSON.stringify({
      entity: {name: 'Alert', key: '{id}', schema: {id: {type: 'string'}}},
    }));

    await expect(loadStores('/repo')).rejects.toThrow('Duplicate store name');
  });

  it('ignores non-JSON files', async () => {
    mockReaddir.mockResolvedValue([
      {name: 'readme.md', isFile: () => true, isDirectory: () => false},
      {name: 'alerts.json', isFile: () => true, isDirectory: () => false},
    ] as unknown as Awaited<ReturnType<typeof readdir>>);

    mockReadFile.mockResolvedValue(JSON.stringify({
      entity: {name: 'Alert', key: '{id}', schema: {id: {type: 'string'}}},
    }));

    const result = await loadStores('/repo');
    expect(result).toHaveLength(1);
  });
});
