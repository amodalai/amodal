/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

/**
 * Integration tests: verifies that connections installed via plugin (npm package)
 * are correctly resolved during repo load and included in deploy snapshots.
 *
 * Simulates the full pipeline:
 *   amodal connect <name>  →  amodal.lock written  →  symlink created
 *   amodal build           →  loadRepoFromDisk     →  resolveAllPackages  →  buildSnapshot
 */

import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import {afterEach, beforeEach, describe, expect, it} from 'vitest';

import {getNpmContextPaths} from './npm-context.js';
import {toSymlinkName} from './package-types.js';
import type {LockFile} from './package-types.js';
import {writeLockFile} from './lock-file.js';
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
async function writeConfig(repoPath: string): Promise<void> {
  await fs.writeFile(
    path.join(repoPath, 'amodal.json'),
    JSON.stringify({
      name: 'test-agent',
      version: '1.0.0',
      models: {main: {provider: 'anthropic', model: 'claude-sonnet-4-20250514'}},
    }),
  );
}

/**
 * Simulate what `amodal connect` does: create the npm package directory,
 * symlink, and lock file entry — without actually running npm.
 */
async function simulatePluginInstall(
  repoPath: string,
  connectionName: string,
  files: Record<string, string>,
): Promise<void> {
  const paths = getNpmContextPaths(repoPath);
  const npmPkgDir = path.join(paths.nodeModules, `@amodalai/connection-${connectionName}`);
  await fs.mkdir(npmPkgDir, {recursive: true});

  for (const [fname, content] of Object.entries(files)) {
    await fs.writeFile(path.join(npmPkgDir, fname), content);
  }

  // Create symlink (same as ensureSymlink)
  await fs.mkdir(paths.root, {recursive: true});
  const symlinkDir = path.join(paths.root, toSymlinkName('connection', connectionName));
  await fs.symlink(npmPkgDir, symlinkDir, 'dir');
}

/**
 * Write the lock file with connection entries.
 */
async function writeLock(
  repoPath: string,
  connections: Array<{name: string; version: string}>,
): Promise<void> {
  const lock: LockFile = {lockVersion: 1, packages: {}};
  for (const c of connections) {
    lock.packages[`connection/${c.name}`] = {
      version: c.version,
      npm: `@amodalai/connection-${c.name}`,
      integrity: `sha256-test-${c.name}`,
    };
  }
  await writeLockFile(repoPath, lock);
}

// Minimal valid spec.json for a plugin connection
function pluginSpec(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    source: 'https://api.example.com/spec.json',
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

describe('plugin connection → build pipeline', () => {
  it('loads a single plugin-installed connection via loadRepoFromDisk', async () => {
    await writeConfig(tmpDir);
    await simulatePluginInstall(tmpDir, 'acme', {
      'spec.json': pluginSpec(),
      'access.json': pluginAccess(),
    });
    await writeLock(tmpDir, [{name: 'acme', version: '1.0.0'}]);

    const repo = await loadRepoFromDisk(tmpDir);

    expect(repo.connections.size).toBe(1);
    expect(repo.connections.has('acme')).toBe(true);
    const conn = repo.connections.get('acme')!;
    expect(conn.spec.baseUrl).toBe('https://api.example.com');
    expect(conn.spec.auth?.type).toBe('bearer');
    expect(conn.access.endpoints['GET /items']).toBeDefined();
  });

  it('includes plugin connections in buildSnapshot output', async () => {
    await writeConfig(tmpDir);
    await simulatePluginInstall(tmpDir, 'acme', {
      'spec.json': pluginSpec(),
      'access.json': pluginAccess(),
      'surface.md': '## Included\n\n### GET /items\nList items\n\n### DELETE /items/:id\nDelete item\n\n## Excluded\n\n### POST /admin\nAdmin only',
      'entities.md': '# Entities\n\n## item\nAn item in the system.',
      'rules.md': '# Rules\n\nAlways paginate list requests.',
    });
    await writeLock(tmpDir, [{name: 'acme', version: '1.0.0'}]);

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
    await writeConfig(tmpDir);
    await simulatePluginInstall(tmpDir, 'acme', {
      'spec.json': pluginSpec(),
      'access.json': pluginAccess(),
    });
    await writeLock(tmpDir, [{name: 'acme', version: '1.0.0'}]);

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
    await writeConfig(tmpDir);
    await simulatePluginInstall(tmpDir, 'acme', {
      'spec.json': pluginSpec({baseUrl: 'https://acme.example.com'}),
      'access.json': pluginAccess(),
    });
    await simulatePluginInstall(tmpDir, 'widgets', {
      'spec.json': pluginSpec({baseUrl: 'https://widgets.example.com'}),
      'access.json': pluginAccess(),
    });
    await writeLock(tmpDir, [
      {name: 'acme', version: '1.0.0'},
      {name: 'widgets', version: '2.0.0'},
    ]);

    const repo = await loadRepoFromDisk(tmpDir);

    expect(repo.connections.size).toBe(2);
    expect(repo.connections.get('acme')!.spec.baseUrl).toBe('https://acme.example.com');
    expect(repo.connections.get('widgets')!.spec.baseUrl).toBe('https://widgets.example.com');

    const snapshot = buildSnapshot(repo, {createdBy: 'test', source: 'cli'});
    expect(Object.keys(snapshot.connections)).toHaveLength(2);
  });

  it('merges plugin connection with repo overrides', async () => {
    await writeConfig(tmpDir);

    // Plugin provides base spec and access
    await simulatePluginInstall(tmpDir, 'acme', {
      'spec.json': pluginSpec({baseUrl: 'https://api.acme.com'}),
      'access.json': pluginAccess(),
      'surface.md': '## Included\n\n- [x] GET /items — List items\n- [x] POST /items — Create item',
    });
    await writeLock(tmpDir, [{name: 'acme', version: '1.0.0'}]);

    // Repo provides override with import header
    const repoConnDir = path.join(tmpDir, 'connections', 'acme');
    await fs.mkdir(repoConnDir, {recursive: true});
    await fs.writeFile(
      path.join(repoConnDir, 'spec.json'),
      JSON.stringify({
        import: 'acme',
        auth: {type: 'bearer', token: 'env:MY_CUSTOM_TOKEN'},
      }),
    );

    const repo = await loadRepoFromDisk(tmpDir);

    expect(repo.connections.size).toBe(1);
    const conn = repo.connections.get('acme')!;
    // Auth should be overridden by repo
    expect(conn.spec.auth?.token).toBe('env:MY_CUSTOM_TOKEN');
    // baseUrl should come from package (merged)
    expect(conn.spec.baseUrl).toBe('https://api.acme.com');
  });

  it('coexists: plugin connections + hand-written connections', async () => {
    await writeConfig(tmpDir);

    // Plugin connection
    await simulatePluginInstall(tmpDir, 'acme', {
      'spec.json': pluginSpec({baseUrl: 'https://acme.example.com'}),
      'access.json': pluginAccess(),
    });
    await writeLock(tmpDir, [{name: 'acme', version: '1.0.0'}]);

    // Hand-written connection (no package, just repo files)
    const repoConnDir = path.join(tmpDir, 'connections', 'internal-api');
    await fs.mkdir(repoConnDir, {recursive: true});
    await fs.writeFile(
      path.join(repoConnDir, 'spec.json'),
      JSON.stringify({
        source: 'https://internal.corp/openapi.json',
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

  it('handles lock file with missing symlink gracefully (warns, does not crash)', async () => {
    await writeConfig(tmpDir);

    // Write lock file referencing a connection that's NOT actually installed
    await writeLock(tmpDir, [{name: 'missing-pkg', version: '1.0.0'}]);

    const repo = await loadRepoFromDisk(tmpDir);

    // Should not crash — connection is simply missing
    expect(repo.connections.has('missing-pkg')).toBe(false);
    // Should have warnings
    expect(repo.warnings).toBeDefined();
    expect(repo.warnings!.some((w) => w.includes('missing-pkg'))).toBe(true);
  });

  it('handles plugin connection with empty optional files', async () => {
    await writeConfig(tmpDir);
    // Only spec.json and access.json — no surface.md, entities.md, or rules.md
    await simulatePluginInstall(tmpDir, 'minimal', {
      'spec.json': pluginSpec(),
      'access.json': pluginAccess(),
    });
    await writeLock(tmpDir, [{name: 'minimal', version: '1.0.0'}]);

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
    await writeConfig(tmpDir);

    // This mirrors the actual Salesforce plugin spec.json structure
    await simulatePluginInstall(tmpDir, 'salesforce', {
      'spec.json': JSON.stringify({
        source: 'https://developer.salesforce.com/docs',
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
    await writeLock(tmpDir, [{name: 'salesforce', version: '2.1.0'}]);

    const repo = await loadRepoFromDisk(tmpDir);

    expect(repo.connections.size).toBe(1);
    expect(repo.connections.has('salesforce')).toBe(true);
  });

  it('loads plugin connection with format=rest (real-world plugin spec)', async () => {
    await writeConfig(tmpDir);

    // Many real plugins use format: "rest" instead of "openapi"
    await simulatePluginInstall(tmpDir, 'internal', {
      'spec.json': JSON.stringify({
        source: 'https://api.internal.com/docs',
        format: 'rest',
        baseUrl: 'https://api.internal.com',
        auth: {type: 'bearer', token: 'env:API_TOKEN'},
      }),
      'access.json': pluginAccess(),
    });
    await writeLock(tmpDir, [{name: 'internal', version: '1.0.0'}]);

    const repo = await loadRepoFromDisk(tmpDir);

    expect(repo.connections.size).toBe(1);
    expect(repo.connections.has('internal')).toBe(true);
  });

  it('loads plugin connection with sync.frequency=hourly', async () => {
    await writeConfig(tmpDir);

    await simulatePluginInstall(tmpDir, 'monitor', {
      'spec.json': JSON.stringify({
        source: 'https://api.monitor.com/spec',
        format: 'openapi',
        baseUrl: 'https://api.monitor.com',
        sync: {auto: true, frequency: 'hourly', notify_drift: true},
      }),
      'access.json': pluginAccess(),
    });
    await writeLock(tmpDir, [{name: 'monitor', version: '1.0.0'}]);

    const repo = await loadRepoFromDisk(tmpDir);
    expect(repo.connections.has('monitor')).toBe(true);
  });

  it('handles lock file with empty integrity (private registry scenario)', async () => {
    await writeConfig(tmpDir);

    await simulatePluginInstall(tmpDir, 'private', {
      'spec.json': pluginSpec(),
      'access.json': pluginAccess(),
    });

    // Simulate what happens with a private registry: empty integrity
    const lock: LockFile = {
      lockVersion: 1,
      packages: {
        'connection/private': {
          version: '1.0.0',
          npm: '@amodalai/connection-private',
          integrity: '',
        },
      },
    };
    await fs.writeFile(
      path.join(tmpDir, 'amodal.lock'),
      JSON.stringify(lock, null, 2) + '\n',
    );

    const repo = await loadRepoFromDisk(tmpDir);
    // Connection should still be loaded despite empty integrity
    expect(repo.connections.size).toBe(1);
    expect(repo.connections.has('private')).toBe(true);
  });
});
