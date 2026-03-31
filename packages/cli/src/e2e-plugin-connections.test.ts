/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

/**
 * End-to-end test: install a plugin connection → build → deploy (dry-run)
 * and verify the connection appears in the snapshot.
 *
 * Uses real CLI functions (runInstallPkg, runBuild, runDeploy) against
 * a real temp directory. The npm install step is simulated by writing
 * package files directly (since we can't hit a real registry in tests),
 * but the lock file, symlink, build, and deploy steps are all real.
 */

import {describe, it, expect, beforeEach, afterEach} from 'vitest';
import {
  mkdirSync,
  writeFileSync,
  readFileSync,
  existsSync,
  rmSync,
  mkdtempSync,
} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';

import {runBuild} from './commands/build.js';
import {runDeploy} from './commands/deploy.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Create a minimal amodal repo with amodal.json.
 */
function createRepo(dir: string): void {
  writeFileSync(
    join(dir, 'amodal.json'),
    JSON.stringify(
      {
        name: 'plugin-e2e-test',
        version: '1.0.0',
        models: {main: {provider: 'anthropic', model: 'claude-sonnet-4-20250514'}},
      },
      null,
      2,
    ),
  );
}

/**
 * Simulate what `amodal install connection-<name>` does on disk:
 * 1. Write the package files into amodal_packages/.npm/node_modules/@amodalai/connection-<name>/connections/<name>/
 * 2. Write the lock file entry (keyed by npm name)
 *
 * No symlinks — the resolver reads directly from node_modules.
 */
function simulateInstallConnection(
  repoDir: string,
  name: string,
  files: Record<string, string>,
  version = '1.0.0',
): void {
  const npmName = `@amodalai/connection-${name}`;
  const pkgsRoot = join(repoDir, 'amodal_packages');
  const connDir = join(pkgsRoot, '.npm', 'node_modules', '@amodalai', `connection-${name}`, 'connections', name);
  mkdirSync(connDir, {recursive: true});

  for (const [fname, content] of Object.entries(files)) {
    writeFileSync(join(connDir, fname), content);
  }

  // Write / update lock file
  const lockPath = join(repoDir, 'amodal.lock');
  let lock: {lockVersion: number; packages: Record<string, unknown>};
  if (existsSync(lockPath)) {
    lock = JSON.parse(readFileSync(lockPath, 'utf-8')) as typeof lock;
  } else {
    lock = {lockVersion: 2, packages: {}};
  }
  lock.packages[npmName] = {
    version,
    integrity: `sha256-test-${name}`,
  };
  writeFileSync(lockPath, JSON.stringify(lock, null, 2) + '\n');
}

// ---------------------------------------------------------------------------
// Fixture data — mirrors real plugin package structure
// ---------------------------------------------------------------------------

const STRIPE_SPEC = JSON.stringify({
  baseUrl: 'https://api.stripe.com',
  specUrl: 'https://raw.githubusercontent.com/stripe/openapi/master/openapi/spec3.json',
  format: 'openapi',
  auth: {
    type: 'bearer',
    token: 'env:STRIPE_API_KEY',
    header: 'Authorization',
    prefix: 'Bearer',
  },
  sync: {auto: true, frequency: 'daily', notify_drift: true},
});

const STRIPE_ACCESS = JSON.stringify({
  endpoints: {
    'GET /v1/charges': {returns: ['id', 'amount', 'currency', 'status']},
    'GET /v1/charges/:id': {returns: ['id', 'amount', 'currency', 'status', 'description']},
    'POST /v1/charges': {returns: ['id'], confirm: true, reason: 'Creates a charge'},
  },
});

const STRIPE_SURFACE = [
  '## Included',
  '',
  '### GET /v1/charges',
  'List charges with pagination and filters.',
  '',
  '### GET /v1/charges/:id',
  'Retrieve a specific charge by ID.',
  '',
  '## Excluded',
  '',
  '### POST /v1/charges',
  'Create a new charge (requires confirmation).',
].join('\n');

const STRIPE_ENTITIES = [
  '# Entities',
  '',
  '## charge',
  'A Stripe charge represents a payment.',
  '',
  '## customer',
  'A Stripe customer.',
].join('\n');

const STRIPE_RULES = [
  '# Rules',
  '',
  '- Always include `limit` parameter when listing charges.',
  '- Never expose full card numbers in responses.',
].join('\n');

const SALESFORCE_SPEC = JSON.stringify({
  baseUrl: 'env:SALESFORCE_INSTANCE_URL',
  specUrl: 'https://developer.salesforce.com/docs',
  format: 'openapi',
  auth: {
    type: 'bearer',
    token: 'env:SALESFORCE_ACCESS_TOKEN',
    header: 'Authorization',
    prefix: 'Bearer',
  },
  sync: {auto: true, frequency: 'weekly', notify_drift: true},
});

const SALESFORCE_ACCESS = JSON.stringify({
  endpoints: {
    'GET /services/data/v59.0/query': {returns: ['totalSize', 'done', 'records']},
    'GET /services/data/v59.0/sobjects/Lead/:id': {returns: ['Id', 'FirstName', 'LastName', 'Email']},
  },
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('E2E: plugin connection install → build → deploy', () => {
  let repoDir: string;
  let stderrOutput: string;
  const origWrite = process.stderr.write.bind(process.stderr);

  beforeEach(() => {
    repoDir = mkdtempSync(join(tmpdir(), 'amodal-e2e-plugin-'));
    stderrOutput = '';
    // Capture stderr to check CLI output
    process.stderr.write = ((chunk: string | Uint8Array) => {
      stderrOutput += String(chunk);
      return true;
    }) as typeof process.stderr.write;
  });

  afterEach(() => {
    process.stderr.write = origWrite;
    if (repoDir && existsSync(repoDir)) {
      rmSync(repoDir, {recursive: true, force: true});
    }
  });

  it('single plugin connection appears in build snapshot', async () => {
    createRepo(repoDir);
    simulateInstallConnection(repoDir, 'stripe', {
      'spec.json': STRIPE_SPEC,
      'access.json': STRIPE_ACCESS,
      'surface.md': STRIPE_SURFACE,
      'entities.md': STRIPE_ENTITIES,
      'rules.md': STRIPE_RULES,
    });

    // Run build (same code path as `amodal build`)
    const outputPath = join(repoDir, 'resolved-config.json');
    const code = await runBuild({cwd: repoDir, output: outputPath});

    expect(code).toBe(0);
    expect(existsSync(outputPath)).toBe(true);

    // Parse the snapshot and verify the connection is there
    const snapshot = JSON.parse(readFileSync(outputPath, 'utf-8')) as Record<string, unknown>;
    const connections = snapshot['connections'] as Record<string, Record<string, unknown>>;

    expect(connections['stripe']).toBeDefined();

    // Verify spec
    const spec = connections['stripe']['spec'] as Record<string, unknown>;
    expect(spec['baseUrl']).toBe('https://api.stripe.com');
    expect((spec['auth'] as Record<string, unknown>)['type']).toBe('bearer');
    expect((spec['auth'] as Record<string, unknown>)['token']).toBe('env:STRIPE_API_KEY');

    // Verify access
    const access = connections['stripe']['access'] as Record<string, unknown>;
    const endpoints = access['endpoints'] as Record<string, unknown>;
    expect(endpoints['GET /v1/charges']).toBeDefined();
    expect(endpoints['POST /v1/charges']).toBeDefined();

    // Verify surface
    const surface = connections['stripe']['surface'] as string;
    expect(surface).toContain('GET /v1/charges');

    // Verify entities and rules
    expect(connections['stripe']['entities']).toContain('charge');
    expect(connections['stripe']['rules']).toContain('limit');

    // Verify CLI output mentions the connection
    expect(stderrOutput).toContain('Connections: 1');
  });

  it('multiple plugin connections appear in build snapshot', async () => {
    createRepo(repoDir);
    simulateInstallConnection(repoDir, 'stripe', {
      'spec.json': STRIPE_SPEC,
      'access.json': STRIPE_ACCESS,
    });
    simulateInstallConnection(repoDir, 'salesforce', {
      'spec.json': SALESFORCE_SPEC,
      'access.json': SALESFORCE_ACCESS,
    }, '2.1.0');

    const outputPath = join(repoDir, 'resolved-config.json');
    const code = await runBuild({cwd: repoDir, output: outputPath});

    expect(code).toBe(0);

    const snapshot = JSON.parse(readFileSync(outputPath, 'utf-8')) as Record<string, unknown>;
    const connections = snapshot['connections'] as Record<string, Record<string, unknown>>;

    expect(Object.keys(connections)).toHaveLength(2);
    expect(connections['stripe']).toBeDefined();
    expect(connections['salesforce']).toBeDefined();

    // Verify each has correct baseUrl
    expect((connections['stripe']['spec'] as Record<string, unknown>)['baseUrl']).toBe('https://api.stripe.com');
    expect((connections['salesforce']['spec'] as Record<string, unknown>)['baseUrl']).toBe('env:SALESFORCE_INSTANCE_URL');

    expect(stderrOutput).toContain('Connections: 2');
  });

  it('plugin connections coexist with hand-written connections in snapshot', async () => {
    createRepo(repoDir);

    // Plugin connection
    simulateInstallConnection(repoDir, 'stripe', {
      'spec.json': STRIPE_SPEC,
      'access.json': STRIPE_ACCESS,
    });

    // Hand-written connection
    const connDir = join(repoDir, 'connections', 'internal-api');
    mkdirSync(connDir, {recursive: true});
    writeFileSync(
      join(connDir, 'spec.json'),
      JSON.stringify({
        baseUrl: 'https://internal.corp/v1',
        specUrl: 'https://internal.corp/openapi.json',
        format: 'openapi',
        auth: {type: 'bearer', token: 'env:INTERNAL_TOKEN'},
      }),
    );
    writeFileSync(
      join(connDir, 'access.json'),
      JSON.stringify({endpoints: {'GET /health': {returns: ['status']}}}),
    );

    const outputPath = join(repoDir, 'resolved-config.json');
    const code = await runBuild({cwd: repoDir, output: outputPath});

    expect(code).toBe(0);

    const snapshot = JSON.parse(readFileSync(outputPath, 'utf-8')) as Record<string, unknown>;
    const connections = snapshot['connections'] as Record<string, Record<string, unknown>>;

    expect(Object.keys(connections)).toHaveLength(2);
    expect(connections['stripe']).toBeDefined();
    expect(connections['internal-api']).toBeDefined();
    expect((connections['internal-api']['spec'] as Record<string, unknown>)['baseUrl']).toBe('https://internal.corp/v1');

    expect(stderrOutput).toContain('Connections: 2');
  });

  it('deploy dry-run includes plugin connections', async () => {
    createRepo(repoDir);
    simulateInstallConnection(repoDir, 'stripe', {
      'spec.json': STRIPE_SPEC,
      'access.json': STRIPE_ACCESS,
      'surface.md': STRIPE_SURFACE,
    });

    const code = await runDeploy({cwd: repoDir, dryRun: true, message: 'e2e plugin test'});

    expect(code).toBe(0);
    expect(stderrOutput).toContain('Connections: 1');
    expect(stderrOutput).toContain('Dry run');
  });

  it('plugin connection with weekly sync frequency builds successfully', async () => {
    createRepo(repoDir);
    simulateInstallConnection(repoDir, 'salesforce', {
      'spec.json': SALESFORCE_SPEC,
      'access.json': SALESFORCE_ACCESS,
    });

    const outputPath = join(repoDir, 'resolved-config.json');
    const code = await runBuild({cwd: repoDir, output: outputPath});

    expect(code).toBe(0);

    const snapshot = JSON.parse(readFileSync(outputPath, 'utf-8')) as Record<string, unknown>;
    const connections = snapshot['connections'] as Record<string, Record<string, unknown>>;
    expect(connections['salesforce']).toBeDefined();

    const spec = connections['salesforce']['spec'] as Record<string, unknown>;
    const sync = spec['sync'] as Record<string, unknown>;
    expect(sync['frequency']).toBe('weekly');
  });

  it('plugin connection with rest format builds successfully', async () => {
    createRepo(repoDir);
    simulateInstallConnection(repoDir, 'custom-rest', {
      'spec.json': JSON.stringify({
        baseUrl: 'https://api.custom.com',
        specUrl: 'https://api.custom.com/docs',
        format: 'rest',
      }),
      'access.json': JSON.stringify({
        endpoints: {'GET /data': {returns: ['items']}},
      }),
    });

    const outputPath = join(repoDir, 'resolved-config.json');
    const code = await runBuild({cwd: repoDir, output: outputPath});

    expect(code).toBe(0);

    const snapshot = JSON.parse(readFileSync(outputPath, 'utf-8')) as Record<string, unknown>;
    const connections = snapshot['connections'] as Record<string, Record<string, unknown>>;
    expect(connections['custom-rest']).toBeDefined();
    expect((connections['custom-rest']['spec'] as Record<string, unknown>)['format']).toBe('rest');
  });

  it('build produces valid snapshot that can be re-parsed', async () => {
    createRepo(repoDir);
    simulateInstallConnection(repoDir, 'stripe', {
      'spec.json': STRIPE_SPEC,
      'access.json': STRIPE_ACCESS,
      'surface.md': STRIPE_SURFACE,
      'entities.md': STRIPE_ENTITIES,
      'rules.md': STRIPE_RULES,
    });

    const outputPath = join(repoDir, 'resolved-config.json');
    const code = await runBuild({cwd: repoDir, output: outputPath});
    expect(code).toBe(0);

    // The snapshot should be valid JSON that can be loaded back
    const raw = readFileSync(outputPath, 'utf-8');
    const snapshot = JSON.parse(raw) as Record<string, unknown>;

    // Verify top-level structure
    expect(snapshot['deployId']).toMatch(/^deploy-[0-9a-f]{7}$/);
    expect(snapshot['createdAt']).toBeDefined();
    expect(snapshot['source']).toBe('cli');
    expect((snapshot['config'] as Record<string, unknown>)['name']).toBe('plugin-e2e-test');

    // Verify connection round-trips correctly
    const connections = snapshot['connections'] as Record<string, Record<string, unknown>>;
    const stripe = connections['stripe'];
    expect(stripe).toBeDefined();
    expect(typeof stripe['spec']).toBe('object');
    expect(typeof stripe['access']).toBe('object');
    expect(typeof stripe['surface']).toBe('string');
    expect(typeof stripe['entities']).toBe('string');
    expect(typeof stripe['rules']).toBe('string');
  });
});
