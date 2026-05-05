/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

/**
 * Phase E.3 + E.4 + E.10 integration test. Pins the agent-admin
 * completion tools end-to-end through the actual runtime path:
 * LocalToolExecutor compiles each handler.ts via esbuild, dynamic-imports
 * the resulting .mjs, and runs it with a CustomToolContext whose
 * completion ops are backed by the real commitSetup primitive +
 * deleteSetupState query (against a temp Postgres + temp repo).
 *
 * Skips when DATABASE_URL or the agent-admin cache isn't populated.
 */

import {existsSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {mkdtemp, readFile, rm} from 'node:fs/promises';
import {homedir, tmpdir} from 'node:os';
import * as path from 'node:path';

import {afterAll, afterEach, beforeAll, beforeEach, describe, expect, it} from 'vitest';

import {and, eq} from 'drizzle-orm';
import {
  closeDb,
  deleteSetupState,
  ensureSchema,
  getDb,
  setupState,
  upsertSetupState,
  type Db,
} from '@amodalai/db';
import type {
  CustomToolCompletionOps,
  CustomToolContext,
  CustomToolInlineEvent,
  LoadedTool,
  SetupPlan,
} from '@amodalai/types';

import {LocalFsBackend} from '../tools/fs/local.js';
import {commitSetup} from '../setup/commit-setup.js';
import {LocalToolExecutor} from './tool-executor-local.js';

const ADMIN_AGENT_PATH = path.join(homedir(), '.amodal', 'admin-agent', 'latest');
const REQUEST_HANDLER = path.join(ADMIN_AGENT_PATH, 'tools', 'request_complete_setup', 'handler.ts');
const FORCE_HANDLER = path.join(ADMIN_AGENT_PATH, 'tools', 'force_complete_setup', 'handler.ts');
const CANCEL_HANDLER = path.join(ADMIN_AGENT_PATH, 'tools', 'cancel_setup', 'handler.ts');

const HAS_DEPS =
  Boolean(process.env['DATABASE_URL']) &&
  existsSync(REQUEST_HANDLER) &&
  existsSync(FORCE_HANDLER) &&
  existsSync(CANCEL_HANDLER);

const describeWhenReady = HAS_DEPS ? describe : describe.skip;

function makePlan(overrides?: Partial<SetupPlan>): SetupPlan {
  return {
    templatePackage: '@amodalai/test-template',
    slots: [],
    config: [],
    completion: {title: 'Test Agent', suggestions: [], automationTitle: null},
    ...overrides,
  };
}

const slackSlot = {
  label: 'Slack',
  description: 'Where the digest gets posted.',
  required: true,
  multi: false,
  options: [
    {
      packageName: '@amodalai/connection-slack',
      displayName: 'Slack',
      authType: 'bearer' as const,
      oauthScopes: [],
    },
  ],
};

describeWhenReady('completion tools (Phase E.3 / E.4 / E.10 integration)', () => {
  let db: Db;
  let repoRoot: string;
  let fs: LocalFsBackend;
  let executor: LocalToolExecutor;
  let agentId: string;
  const scopeId = '';

  beforeAll(async () => {
    db = getDb();
    await ensureSchema(db);
  });

  afterAll(async () => {
    await closeDb();
  });

  beforeEach(async () => {
    repoRoot = await mkdtemp(path.join(tmpdir(), 'completion-'));
    fs = new LocalFsBackend({repoRoot});
    executor = new LocalToolExecutor();
    agentId = `agent_${randomUUID()}`;
  });

  afterEach(async () => {
    executor.dispose();
    try {
      await deleteSetupState(db, agentId, scopeId);
    } catch {
      // Best-effort.
    }
    await rm(repoRoot, {recursive: true, force: true});
  });

  function loadedTool(handlerPath: string, name: string): LoadedTool {
    return {
      name,
      description: `${name} test`,
      parameters: {},
      confirm: false,
      timeout: 10_000,
      env: [],
      handlerPath,
      location: path.dirname(handlerPath),
      hasPackageJson: false,
      hasSetupScript: false,
      hasRequirementsTxt: false,
      hasDockerfile: false,
      sandboxLanguage: 'typescript',
    };
  }

  function buildCompletionOps(): CustomToolCompletionOps {
    return {
      async commit(opts) {
        const result = await commitSetup({
          db,
          fs,
          agentId,
          scopeId,
          force: opts?.force ?? false,
        });
        if (result.ok) {
          return {
            ok: true,
            alreadyComplete: result.alreadyComplete,
            completedAt: result.completedAt.toISOString(),
          };
        }
        if (result.reason === 'not_ready') {
          return {ok: false, reason: 'not_ready', warnings: result.warnings};
        }
        return {ok: false, reason: 'no_state', message: result.message};
      },
      async cancel() {
        const deleted = await deleteSetupState(db, agentId, scopeId);
        return {ok: true, deleted};
      },
    };
  }

  function buildCtx(opts?: {emitCapture?: CustomToolInlineEvent[]; completion?: CustomToolCompletionOps | null}): CustomToolContext {
    const completion =
      opts && Object.prototype.hasOwnProperty.call(opts, 'completion')
        ? opts.completion
        : buildCompletionOps();
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
      agentId,
      scopeId,
      sessionId: 'sess_test',
      ...(completion ? {completion} : {}),
      ...(opts?.emitCapture
        ? {
            emit: (event: CustomToolInlineEvent) => {
              opts.emitCapture?.push(event);
            },
          }
        : {}),
    };
  }

  // -------------------------------------------------------------------
  // request_complete_setup (E.3)
  // -------------------------------------------------------------------

  it('request_complete_setup returns not_ready with warnings when slots are missing', async () => {
    await upsertSetupState(db, agentId, scopeId, {
      phase: 'configuring',
      plan: makePlan({slots: [slackSlot]}),
    });

    const result = await executor.execute(loadedTool(REQUEST_HANDLER, 'request_complete_setup'), {}, buildCtx());
    expect(result).toMatchObject({ok: false, reason: 'not_ready'});
     
    const r = result as {warnings: Array<{target: string}>};
    expect(r.warnings[0]?.target).toBe('Slack');

    // amodal.json was NOT written.
    await expect(readFile(path.join(repoRoot, 'amodal.json'), 'utf-8')).rejects.toThrow();
  });

  it('request_complete_setup commits when validation passes and writes amodal.json', async () => {
    await upsertSetupState(db, agentId, scopeId, {
      phase: 'configuring',
      plan: makePlan({
        slots: [slackSlot],
        completion: {title: 'Slackbot', suggestions: [], automationTitle: null},
      }),
      appendCompleted: [
        {
          slotLabel: 'Slack',
          packageName: '@amodalai/connection-slack',
          connectedAt: new Date().toISOString(),
          validatedAt: new Date().toISOString(),
          validationFormatted: 'Found 12 channels',
        },
      ],
    });

    const result = await executor.execute(loadedTool(REQUEST_HANDLER, 'request_complete_setup'), {}, buildCtx());
    expect(result).toMatchObject({ok: true, alreadyComplete: false});

    const written = JSON.parse(await readFile(path.join(repoRoot, 'amodal.json'), 'utf-8')) as {
      name: string;
      packages?: string[];
    };
    expect(written.name).toBe('slackbot');
    expect(written.packages).toContain('@amodalai/connection-slack');
  });

  it('request_complete_setup is idempotent — second call returns alreadyComplete:true', async () => {
    await upsertSetupState(db, agentId, scopeId, {
      phase: 'configuring',
      plan: makePlan(),
    });
    const r1 = await executor.execute(loadedTool(REQUEST_HANDLER, 'request_complete_setup'), {}, buildCtx());
    const r2 = await executor.execute(loadedTool(REQUEST_HANDLER, 'request_complete_setup'), {}, buildCtx());
    expect(r1).toMatchObject({ok: true});
    expect(r2).toMatchObject({ok: true, alreadyComplete: true});
  });

  it('request_complete_setup returns no_ops when ctx.completion is absent', async () => {
    const result = await executor.execute(
      loadedTool(REQUEST_HANDLER, 'request_complete_setup'),
      {},
      buildCtx({completion: null}),
    );
    expect(result).toMatchObject({ok: false, reason: 'no_ops'});
  });

  // -------------------------------------------------------------------
  // force_complete_setup (E.4)
  // -------------------------------------------------------------------

  it('force_complete_setup commits even with missing required slots', async () => {
    await upsertSetupState(db, agentId, scopeId, {
      phase: 'configuring',
      plan: makePlan({slots: [slackSlot]}),
    });

    const result = await executor.execute(loadedTool(FORCE_HANDLER, 'force_complete_setup'), {}, buildCtx());
    expect(result).toMatchObject({ok: true, alreadyComplete: false});

    const written = await readFile(path.join(repoRoot, 'amodal.json'), 'utf-8');
    expect(written.length).toBeGreaterThan(0);
  });

  // -------------------------------------------------------------------
  // cancel_setup (E.10)
  // -------------------------------------------------------------------

  it('cancel_setup deletes the row + emits a setup_cancelled SSE event', async () => {
    await upsertSetupState(db, agentId, scopeId, {phase: 'planning'});

    const captured: CustomToolInlineEvent[] = [];
    const result = await executor.execute(
      loadedTool(CANCEL_HANDLER, 'cancel_setup'),
      {reason: 'wants a different template'},
      buildCtx({emitCapture: captured}),
    );
    expect(result).toMatchObject({ok: true, deleted: true});

    expect(captured).toHaveLength(1);
    const event = captured[0];
    if (event.type !== 'setup_cancelled') throw new Error('expected setup_cancelled');
    expect(event.reason).toBe('wants a different template');

    // Row is gone.
    const fresh = await db
      .select()
      .from(setupState)
      .where(and(eq(setupState.agentId, agentId), eq(setupState.scopeId, scopeId)));
    expect(fresh).toHaveLength(0);
  });

  it('cancel_setup returns deleted: false when no row existed', async () => {
    const captured: CustomToolInlineEvent[] = [];
    const result = await executor.execute(
      loadedTool(CANCEL_HANDLER, 'cancel_setup'),
      {},
      buildCtx({emitCapture: captured}),
    );
    expect(result).toMatchObject({ok: true, deleted: false});
    // The setup_cancelled event still fires — the agent emitting it
    // is signaling intent, not confirming a row delete; Studio
    // should flip to picker either way.
    expect(captured).toHaveLength(1);
  });

  it('cancel_setup returns no_ops when ctx.completion is absent', async () => {
    const result = await executor.execute(
      loadedTool(CANCEL_HANDLER, 'cancel_setup'),
      {},
      buildCtx({completion: null}),
    );
    expect(result).toMatchObject({ok: false, reason: 'no_ops'});
  });
});
