/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

/**
 * Integration tests: verifies that connections installed via package (npm)
 * are correctly resolved during repo load and included in deploy snapshots.
 *
 * Simulates the full pipeline:
 *   amodal connect <name>  ->  package in node_modules
 *   amodal build           ->  loadRepoFromDisk  ->  resolveAllPackages  ->  buildSnapshot
 */

import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import {afterEach, beforeEach, describe, expect, it} from 'vitest';

import {loadRepoFromDisk} from '../repo/local-reader.js';
import {buildSnapshot} from '../snapshot/snapshot-builder.js';
import {buildConnectionsMap} from '../runtime/connection-bridge.js';

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'plugin-build-test-'));
});

afterEach(async () => {
  await fs.rm(tmpDir, {recursive: true, force: true});
});

/**
 * Write amodal.json config file.
 */
async function writeConfig(repoPath: string, packages?: string[]): Promise<void> {
  await fs.writeFile(
    path.join(repoPath, 'amodal.json'),
    JSON.stringify({
      name: 'test-agent',
      version: '1.0.0',
      models: {main: {provider: 'anthropic', model: 'claude-sonnet-4-20250514'}},
      ...(packages ? {packages} : {}),
    }),
  );
}

/**
 * Simulate what `amodal connect` does: create the npm package directory
 * with connection content in the expected subdirectory structure.
 */
async function simulatePluginInstall(
  repoPath: string,
  connectionName: string,
  files: Record<string, string>,
): Promise<void> {
  // Package contains a connections/<name>/ subdirectory with the connection files
  const connDir = path.join(repoPath, 'node_modules', `@amodalai/connection-${connectionName}`, 'connections', connectionName);
  await fs.mkdir(connDir, {recursive: true});

  for (const [fname, content] of Object.entries(files)) {
    await fs.writeFile(path.join(connDir, fname), content);
  }
}

// Minimal valid spec.json for a plugin connection
function pluginSpec(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    specUrl: 'https://api.example.com/spec.json',
    format: 'openapi',
    baseUrl: 'https://api.example.com',
    auth: {
      type: 'bearer',
      token: 'env:EXAMPLE_TOKEN',
      header: 'Authorization',
      prefix: 'Bearer',
    },
    ...overrides,
  });
}

// Minimal valid access.json
function pluginAccess(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    endpoints: {'GET /items': {returns: ['item']}},
    ...overrides,
  });
}

describe('plugin connection -> build pipeline', () => {
  it('loads a single plugin-installed connection via loadRepoFromDisk', async () => {
    await writeConfig(tmpDir, ['@amodalai/connection-acme']);
    await simulatePluginInstall(tmpDir, 'acme', {
      'spec.json': pluginSpec(),
      'access.json': pluginAccess(),
    });

    const repo = await loadRepoFromDisk(tmpDir);

    expect(repo.connections.size).toBe(1);
    expect(repo.connections.has('acme')).toBe(true);
    const conn = repo.connections.get('acme')!;
    expect(conn.spec.baseUrl).toBe('https://api.example.com');
    expect(conn.spec.auth?.type).toBe('bearer');
    expect(conn.access.endpoints['GET /items']).toBeDefined();
  });

  it('includes plugin connections in buildSnapshot output', async () => {
    await writeConfig(tmpDir, ['@amodalai/connection-acme']);
    await simulatePluginInstall(tmpDir, 'acme', {
      'spec.json': pluginSpec(),
      'access.json': pluginAccess(),
      'surface.md': '## Included\n\n### GET /items\nList items\n\n### DELETE /items/:id\nDelete item\n\n## Excluded\n\n### POST /admin\nAdmin only',
      'entities.md': '# Entities\n\n## item\nAn item in the system.',
      'rules.md': '# Rules\n\nAlways paginate list requests.',
    });

    const repo = await loadRepoFromDisk(tmpDir);
    const snapshot = buildSnapshot(repo, {
      createdBy: 'test',
      source: 'cli',
    });

    expect(snapshot.connections['acme']).toBeDefined();
    expect(snapshot.connections['acme'].spec.baseUrl).toBe('https://api.example.com');
    expect(snapshot.connections['acme'].access.endpoints['GET /items']).toBeDefined();
    expect(snapshot.connections['acme'].surface).toContain('GET /items');
    expect(snapshot.connections['acme'].entities).toContain('item');
    expect(snapshot.connections['acme'].rules).toContain('paginate');
  });

  it('builds ConnectionsMap with auth from plugin connections', async () => {
    await writeConfig(tmpDir, ['@amodalai/connection-acme']);
    await simulatePluginInstall(tmpDir, 'acme', {
      'spec.json': pluginSpec(),
      'access.json': pluginAccess(),
    });

    const repo = await loadRepoFromDisk(tmpDir);
    const connectionsMap = buildConnectionsMap(repo.connections);

    expect(connectionsMap['acme']).toBeDefined();
    expect(connectionsMap['acme']['base_url']).toBe('https://api.example.com');
    // Auth should be built from spec.auth
    const reqConfig = connectionsMap['acme']['_request_config'] as Record<string, unknown>;
    const auth = reqConfig['auth'] as Array<{header: string; value_template: string}>;
    expect(auth).toHaveLength(1);
    expect(auth[0].header).toBe('Authorization');
    // Token is env:EXAMPLE_TOKEN which isn't set, so it becomes a template
    expect(auth[0].value_template).toContain('EXAMPLE_TOKEN');
  });

  it('loads multiple plugin connections', async () => {
    await writeConfig(tmpDir, ['@amodalai/connection-acme', '@amodalai/connection-widgets']);
    await simulatePluginInstall(tmpDir, 'acme', {
      'spec.json': pluginSpec({baseUrl: 'https://acme.example.com'}),
      'access.json': pluginAccess(),
    });
    await simulatePluginInstall(tmpDir, 'widgets', {
      'spec.json': pluginSpec({baseUrl: 'https://widgets.example.com'}),
      'access.json': pluginAccess(),
    });

    const repo = await loadRepoFromDisk(tmpDir);

    expect(repo.connections.size).toBe(2);
    expect(repo.connections.get('acme')!.spec.baseUrl).toBe('https://acme.example.com');
    expect(repo.connections.get('widgets')!.spec.baseUrl).toBe('https://widgets.example.com');

    const snapshot = buildSnapshot(repo, {createdBy: 'test', source: 'cli'});
    expect(Object.keys(snapshot.connections)).toHaveLength(2);
  });

  it('local repo connection overrides plugin connection with same name', async () => {
    await writeConfig(tmpDir, ['@amodalai/connection-acme']);

    // Plugin provides base spec and access
    await simulatePluginInstall(tmpDir, 'acme', {
      'spec.json': pluginSpec({baseUrl: 'https://api.acme.com'}),
      'access.json': pluginAccess(),
    });

    // Repo provides a full local connection with the same name — local wins
    const repoConnDir = path.join(tmpDir, 'connections', 'acme');
    await fs.mkdir(repoConnDir, {recursive: true});
    await fs.writeFile(
      path.join(repoConnDir, 'spec.json'),
      pluginSpec({
        baseUrl: 'https://local.acme.com',
        auth: {type: 'bearer', token: 'env:MY_CUSTOM_TOKEN'},
      }),
    );
    await fs.writeFile(
      path.join(repoConnDir, 'access.json'),
      pluginAccess(),
    );

    const repo = await loadRepoFromDisk(tmpDir);

    expect(repo.connections.size).toBe(1);
    const conn = repo.connections.get('acme')!;
    // Local repo wins entirely
    expect(conn.spec.auth?.token).toBe('env:MY_CUSTOM_TOKEN');
    expect(conn.spec.baseUrl).toBe('https://local.acme.com');
  });

  it('coexists: plugin connections + hand-written connections', async () => {
    await writeConfig(tmpDir, ['@amodalai/connection-acme']);

    // Plugin connection
    await simulatePluginInstall(tmpDir, 'acme', {
      'spec.json': pluginSpec({baseUrl: 'https://acme.example.com'}),
      'access.json': pluginAccess(),
    });

    // Hand-written connection (no package, just repo files)
    const repoConnDir = path.join(tmpDir, 'connections', 'internal-api');
    await fs.mkdir(repoConnDir, {recursive: true});
    await fs.writeFile(
      path.join(repoConnDir, 'spec.json'),
      JSON.stringify({
        specUrl: 'https://internal.corp/openapi.json',
        format: 'openapi',
        baseUrl: 'https://internal.corp/v1',
      }),
    );
    await fs.writeFile(
      path.join(repoConnDir, 'access.json'),
      JSON.stringify({endpoints: {'GET /health': {returns: ['status']}}}),
    );

    const repo = await loadRepoFromDisk(tmpDir);

    expect(repo.connections.size).toBe(2);
    expect(repo.connections.has('acme')).toBe(true);
    expect(repo.connections.has('internal-api')).toBe(true);

    const snapshot = buildSnapshot(repo, {createdBy: 'test', source: 'cli'});
    expect(Object.keys(snapshot.connections)).toHaveLength(2);
    expect(snapshot.connections['acme'].spec.baseUrl).toBe('https://acme.example.com');
    expect(snapshot.connections['internal-api'].spec.baseUrl).toBe('https://internal.corp/v1');
  });

  it('handles missing package gracefully (does not crash)', async () => {
    await writeConfig(tmpDir);

    // No packages installed — just an empty repo
    const repo = await loadRepoFromDisk(tmpDir);

    // Should not crash
    expect(repo.connections.size).toBe(0);
  });

  it('handles plugin connection with empty optional files', async () => {
    await writeConfig(tmpDir, ['@amodalai/connection-minimal']);
    // Only spec.json and access.json — no surface.md, entities.md, or rules.md
    await simulatePluginInstall(tmpDir, 'minimal', {
      'spec.json': pluginSpec(),
      'access.json': pluginAccess(),
    });

    const repo = await loadRepoFromDisk(tmpDir);

    expect(repo.connections.size).toBe(1);
    const conn = repo.connections.get('minimal')!;
    expect(conn.surface).toEqual([]);
    expect(conn.entities).toBeUndefined();
    expect(conn.rules).toBeUndefined();

    // Should still build a snapshot without error
    const snapshot = buildSnapshot(repo, {createdBy: 'test', source: 'cli'});
    expect(snapshot.connections['minimal']).toBeDefined();
  });

  it('loads plugin connection with sync.frequency=weekly (real-world plugin spec)', async () => {
    await writeConfig(tmpDir, ['@amodalai/connection-salesforce']);

    // This mirrors the actual Salesforce plugin spec.json structure
    await simulatePluginInstall(tmpDir, 'salesforce', {
      'spec.json': JSON.stringify({
        specUrl: 'https://developer.salesforce.com/docs',
        format: 'openapi',
        baseUrl: 'env:SALESFORCE_INSTANCE_URL',
        auth: {
          type: 'bearer',
          token: 'env:SALESFORCE_ACCESS_TOKEN',
          header: 'Authorization',
          prefix: 'Bearer',
        },
        sync: {
          auto: true,
          frequency: 'weekly',
          notify_drift: true,
        },
      }),
      'access.json': pluginAccess(),
    });

    const repo = await loadRepoFromDisk(tmpDir);

    expect(repo.connections.size).toBe(1);
    expect(repo.connections.has('salesforce')).toBe(true);
  });

  it('loads plugin connection with format=rest (real-world plugin spec)', async () => {
    await writeConfig(tmpDir, ['@amodalai/connection-internal']);

    // Many real plugins use format: 'rest' instead of 'openapi'
    await simulatePluginInstall(tmpDir, 'internal', {
      'spec.json': JSON.stringify({
        specUrl: 'https://api.internal.com/docs',
        format: 'rest',
        baseUrl: 'https://api.internal.com',
        auth: {type: 'bearer', token: 'env:API_TOKEN'},
      }),
      'access.json': pluginAccess(),
    });

    const repo = await loadRepoFromDisk(tmpDir);

    expect(repo.connections.size).toBe(1);
    expect(repo.connections.has('internal')).toBe(true);
  });

  it('loads plugin connection with sync.frequency=hourly', async () => {
    await writeConfig(tmpDir, ['@amodalai/connection-monitor']);

    await simulatePluginInstall(tmpDir, 'monitor', {
      'spec.json': JSON.stringify({
        specUrl: 'https://api.monitor.com/spec',
        format: 'openapi',
        baseUrl: 'https://api.monitor.com',
        sync: {auto: true, frequency: 'hourly', notify_drift: true},
      }),
      'access.json': pluginAccess(),
    });

    const repo = await loadRepoFromDisk(tmpDir);
    expect(repo.connections.has('monitor')).toBe(true);
  });
});
