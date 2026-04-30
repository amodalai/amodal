/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

/**
 * Phase C integration test for `load_template_plan`. Pins the
 * end-to-end runtime path: LocalToolExecutor compiles the
 * agent-admin handler via esbuild, dynamic-imports the resulting
 * .mjs, and runs it with a CustomToolContext carrying a real
 * `ctx.plan.compose` ops object backed by `composePlan` from
 * `@amodalai/core`.
 *
 * The test sets up a synthetic repo with a fake template package +
 * connection packages so the entire compose chain runs against real
 * disk reads. Skips when the agent-admin cache isn't populated.
 */

import {existsSync} from 'node:fs';
import {mkdir, mkdtemp, rm, writeFile} from 'node:fs/promises';
import {homedir, tmpdir} from 'node:os';
import * as path from 'node:path';

import {afterEach, beforeEach, describe, expect, it} from 'vitest';

import {composePlan} from '@amodalai/core';
import type {CustomToolContext, CustomToolPlanOps, LoadedTool} from '@amodalai/types';

import {LocalToolExecutor} from './tool-executor-local.js';

const ADMIN_AGENT_PATH = path.join(homedir(), '.amodal', 'admin-agent', 'latest');
const HANDLER = path.join(ADMIN_AGENT_PATH, 'tools', 'load_template_plan', 'handler.ts');
const HAS_HANDLER = existsSync(HANDLER);
const describeWhenReady = HAS_HANDLER ? describe : describe.skip;

describeWhenReady('load_template_plan (Phase C integration)', () => {
  let repoRoot: string;
  let executor: LocalToolExecutor;

  beforeEach(async () => {
    repoRoot = await mkdtemp(path.join(tmpdir(), 'phase-c-'));
    executor = new LocalToolExecutor();
  });

  afterEach(async () => {
    executor.dispose();
    await rm(repoRoot, {recursive: true, force: true});
  });

  function loadedTool(): LoadedTool {
    return {
      name: 'load_template_plan',
      description: 'load_template_plan test',
      parameters: {},
      confirm: false,
      timeout: 10_000,
      env: [],
      handlerPath: HANDLER,
      location: path.dirname(HANDLER),
      hasPackageJson: false,
      hasSetupScript: false,
      hasRequirementsTxt: false,
      hasDockerfile: false,
      sandboxLanguage: 'typescript',
    };
  }

  function buildPlanOps(): CustomToolPlanOps {
    return {
      async compose(templatePackageName) {
        try {
          const composed = await composePlan({repoPath: repoRoot, templatePackage: templatePackageName});
          return {ok: true, plan: composed};
        } catch (err) {
          if (
            err !== null &&
            typeof err === 'object' &&
            'code' in err &&
            (err as {code: unknown}).code === 'CONFIG_NOT_FOUND'
          ) {
            return {
              ok: false,
              reason: 'not_installed',
              message: `Template "${templatePackageName}" is not installed.`,
            };
          }
          return {
            ok: false,
            reason: 'malformed',
            message: err instanceof Error ? err.message : String(err),
          };
        }
      },
    };
  }

  function buildCtx(opts?: {planOps?: CustomToolPlanOps | null}): CustomToolContext {
    // null = explicitly omit ctx.plan; undefined / missing = use the default real ops.
    const planOps =
      opts && Object.prototype.hasOwnProperty.call(opts, 'planOps')
        ? opts.planOps
        : buildPlanOps();
    return {
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
      agentId: 'agent_test',
      scopeId: '',
      sessionId: 'sess_test',
      ...(planOps ? {plan: planOps} : {}),
    };
  }

  async function writeJson(rel: string, value: unknown): Promise<void> {
    const full = path.join(repoRoot, rel);
    await mkdir(path.dirname(full), {recursive: true});
    await writeFile(full, JSON.stringify(value), 'utf-8');
  }

  it('returns a SetupPlan composed from the template + connection packages', async () => {
    await writeJson('node_modules/@amodalai/test-template/template.json', {
      connections: [
        {
          label: 'Slack',
          description: 'Where the digest gets posted.',
          options: ['@amodalai/connection-slack'],
          required: true,
        },
      ],
    });
    await writeJson('node_modules/@amodalai/connection-slack/package.json', {
      name: '@amodalai/connection-slack',
      amodal: {
        displayName: 'Slack',
        auth: {type: 'bearer'},
        oauth: {scopes: ['chat:write']},
      },
    });

    const result = await executor.execute(
      loadedTool(),
      {packageName: '@amodalai/test-template'},
      buildCtx(),
    );
     
    const r = result as {ok: true; plan: {slots: Array<{label: string; options: Array<{displayName: string}>}>}};
    expect(r.ok).toBe(true);
    expect(r.plan.slots).toHaveLength(1);
    expect(r.plan.slots[0].label).toBe('Slack');
    expect(r.plan.slots[0].options[0].displayName).toBe('Slack');
  });

  it('surfaces not_installed soft-fail when the template is missing', async () => {
    const result = await executor.execute(
      loadedTool(),
      {packageName: '@amodalai/never-installed'},
      buildCtx(),
    );
    expect(result).toMatchObject({ok: false, reason: 'not_installed'});
  });

  it('rejects path-traversal package names without filesystem access', async () => {
    const result = await executor.execute(
      loadedTool(),
      {packageName: '../../etc/passwd'},
      buildCtx(),
    );
    expect(result).toMatchObject({ok: false, reason: 'error'});
  });

  it('returns no_ops when ctx.plan is absent', async () => {
    const result = await executor.execute(
      loadedTool(),
      {packageName: '@amodalai/test'},
      buildCtx({planOps: null}),
    );
    expect(result).toMatchObject({ok: false, reason: 'no_ops'});
  });
});
