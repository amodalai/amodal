/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

/**
 * Phase A integration test for `validate_connection`.
 *
 * Pins the contract end-to-end through the actual runtime code path:
 * the LocalToolExecutor compiles handler.ts via esbuild, dynamic-imports
 * the resulting .mjs, and runs it with a CustomToolContext that carries
 * a real LocalFsBackend bound to a temp repo. The temp repo holds a
 * fake `node_modules/@amodalai/connection-fake/validate.js` whose probe
 * returns a known shape; the test asserts the formatted output and the
 * soft-fail propagation match the spec.
 *
 * Differs from the agent-admin-side standalone smoke test in that it
 * exercises (1) esbuild's actual `build()` API (not `transform`), with
 * the same options the runtime uses, and (2) the LocalFsBackend
 * sandboxed read of the probe file. Catches regressions where the
 * runtime-side compilation drifts from what the handler expects.
 *
 * The handler source is loaded from the agent-admin worktree the
 * runtime ships against (~/.amodal/admin-agent/latest/). The test
 * skips when that directory isn't populated — i.e. the user hasn't run
 * `amodal dev` yet to seed the cache. CI sets up the cache before
 * running.
 */

import {existsSync} from 'node:fs';
import {mkdir, mkdtemp, rm, writeFile} from 'node:fs/promises';
import {homedir, tmpdir} from 'node:os';
import * as path from 'node:path';

import {afterEach, beforeEach, describe, expect, it} from 'vitest';

import {LocalToolExecutor} from './tool-executor-local.js';
import {LocalFsBackend} from '../tools/fs/local.js';
import type {LoadedTool, CustomToolContext} from '@amodalai/types';

const ADMIN_AGENT_PATH = path.join(homedir(), '.amodal', 'admin-agent', 'latest');
const VALIDATE_CONNECTION_HANDLER = path.join(
  ADMIN_AGENT_PATH,
  'tools',
  'validate_connection',
  'handler.ts',
);

const HAS_CACHED_AGENT_ADMIN =
  existsSync(ADMIN_AGENT_PATH) && existsSync(VALIDATE_CONNECTION_HANDLER);

// Skip the whole suite when the cache isn't populated. The integration
// test only runs in environments where agent-admin has been synced —
// typically a developer machine after `amodal dev` has spawned the
// admin agent at least once, or CI after an explicit setup step.
const describeWhenCached = HAS_CACHED_AGENT_ADMIN ? describe : describe.skip;

describeWhenCached('validate_connection integration (Phase A)', () => {
  let repoRoot: string;
  let executor: LocalToolExecutor;
  let fakePackageDir: string;

  beforeEach(async () => {
    repoRoot = await mkdtemp(path.join(tmpdir(), 'phase-a-'));
    fakePackageDir = path.join(repoRoot, 'node_modules', '@amodalai', 'connection-fake');
    await mkdir(fakePackageDir, {recursive: true});
    executor = new LocalToolExecutor();
  });

  afterEach(async () => {
    executor.dispose();
    await rm(repoRoot, {recursive: true, force: true});
  });

  function loadedTool(): LoadedTool {
    return {
      name: 'validate_connection',
      description: 'Validate a connection probe.',
      parameters: {},
      confirm: false,
      timeout: 15_000,
      env: [],
      handlerPath: VALIDATE_CONNECTION_HANDLER,
      location: path.dirname(VALIDATE_CONNECTION_HANDLER),
      hasPackageJson: false,
      hasSetupScript: false,
      hasRequirementsTxt: false,
      hasDockerfile: false,
      sandboxLanguage: 'typescript',
    };
  }

  function buildCtx(): CustomToolContext {
    const fs = new LocalFsBackend({repoRoot});
    return {
      // Legacy fields the handler doesn't reach for; satisfy the type.
       
      async request() {
        throw new Error('not used');
      },
       
      async exec() {
        throw new Error('not used');
      },
       
      async store() {
        throw new Error('not used');
      },
      env: () => undefined,
      log: () => undefined,
      signal: AbortSignal.timeout(30_000),
      // SDK fields the handler does use.
      fs,
      agentId: 'agent_test',
      scopeId: '',
      sessionId: 'sess_test',
    };
  }

  async function writeFakeProbe(source: string): Promise<void> {
    await writeFile(path.join(fakePackageDir, 'validate.js'), source, 'utf-8');
  }

  it('runs a probe end-to-end and formats the extracted value', async () => {
    await writeFakeProbe(`
      export async function list_channels() {
        return { ok: true, channelCount: 8200, sampleChannels: ['eng', 'mkt', 'random'] };
      }
    `);

    const result = await executor.execute(
      loadedTool(),
      {
        packageName: '@amodalai/connection-fake',
        probeName: 'list_channels',
        extractPath: 'channelCount',
        format: 'count',
      },
      buildCtx(),
    );

    expect(result).toMatchObject({ok: true, value: 8200, formatted: '8.2k'});
  });

  it('propagates probe soft-fail with reason and message', async () => {
    await writeFakeProbe(`
      export async function list_channels() {
        return { ok: false, reason: 'auth_failed', message: 'invalid_auth' };
      }
    `);

    const result = await executor.execute(
      loadedTool(),
      {packageName: '@amodalai/connection-fake', probeName: 'list_channels'},
      buildCtx(),
    );

    expect(result).toMatchObject({ok: false, reason: 'auth_failed', message: 'invalid_auth'});
  });

  it('returns no_data when the extractPath is missing', async () => {
    await writeFakeProbe(`
      export async function get_property() {
        return { ok: true, propertyCount: 0 };
      }
    `);

    const result = await executor.execute(
      loadedTool(),
      {
        packageName: '@amodalai/connection-fake',
        probeName: 'get_property',
        extractPath: 'sessionsThisWeek', // not present
      },
      buildCtx(),
    );

    expect(result).toMatchObject({ok: false, reason: 'no_data'});
  });

  it('rejects an invalid package name without filesystem access', async () => {
    const result = await executor.execute(
      loadedTool(),
      {packageName: '../../etc/passwd', probeName: 'x'},
      buildCtx(),
    );
    expect(result).toMatchObject({ok: false, reason: 'error'});
  });

  it('reports error when the probe export is missing', async () => {
    await writeFakeProbe('export async function other_probe() { return { ok: true, n: 1 }; }');

    const result = await executor.execute(
      loadedTool(),
      {packageName: '@amodalai/connection-fake', probeName: 'list_channels'},
      buildCtx(),
    );

    expect(result).toMatchObject({ok: false, reason: 'error'});
     
    const r = result as {message: string};
    expect(r.message).toMatch(/list_channels.*not exported/);
  });

  it('returns soft-success when validate.js is missing entirely', async () => {
    // No writeFakeProbe — package dir exists but no validate.js inside.
    // Most published connection packages don't ship a probe yet, so a
    // missing validate.js is treated as "connected, no sanity check"
    // rather than a hard error. The user already authenticated; the
    // probe is a confidence-boost, not a gate.
    const result = await executor.execute(
      loadedTool(),
      {packageName: '@amodalai/connection-fake', probeName: 'list_channels'},
      buildCtx(),
    );

    expect(result).toMatchObject({ok: true, value: true});
    const r = result as {formatted: string};
    expect(r.formatted).toMatch(/^Connected/);
  });
});
