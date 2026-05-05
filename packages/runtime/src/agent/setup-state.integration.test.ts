/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

/**
 * Phase B integration test for `read_setup_state` and
 * `update_setup_state`. Pins the contract end-to-end through the
 * actual runtime path: LocalToolExecutor compiles handler.ts via
 * esbuild, dynamic-imports the resulting .mjs, and runs it with a
 * CustomToolContext carrying a real `ctx.setupState` ops object
 * backed by the live Drizzle query module.
 *
 * Requires a live Postgres at $DATABASE_URL and the agent-admin cache
 * at ~/.amodal/admin-agent/latest/. Skips otherwise.
 */

import {existsSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {homedir} from 'node:os';
import * as path from 'node:path';

import {afterAll, afterEach, beforeAll, beforeEach, describe, expect, it} from 'vitest';
import {and, eq} from 'drizzle-orm';
import {
  closeDb,
  ensureSchema,
  getDb,
  getSetupState,
  upsertSetupState,
  markComplete,
  setupState,
  type Db,
} from '@amodalai/db';
import type {CustomToolContext} from '@amodalai/types';

import {LocalToolExecutor} from './tool-executor-local.js';
import type {LoadedTool} from '@amodalai/types';

const ADMIN_AGENT_PATH = path.join(homedir(), '.amodal', 'admin-agent', 'latest');
const READ_HANDLER = path.join(ADMIN_AGENT_PATH, 'tools', 'read_setup_state', 'handler.ts');
const UPDATE_HANDLER = path.join(ADMIN_AGENT_PATH, 'tools', 'update_setup_state', 'handler.ts');

const HAS_DEPS =
  Boolean(process.env['DATABASE_URL']) &&
  existsSync(READ_HANDLER) &&
  existsSync(UPDATE_HANDLER);

const describeWhenReady = HAS_DEPS ? describe : describe.skip;

describeWhenReady('setup_state custom tools (Phase B integration)', () => {
  let db: Db;
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

  beforeEach(() => {
    executor = new LocalToolExecutor();
    agentId = `agent_${randomUUID()}`;
  });

  afterEach(async () => {
    executor.dispose();
    await db
      .delete(setupState)
      .where(and(eq(setupState.agentId, agentId), eq(setupState.scopeId, scopeId)));
  });

  function loadedTool(handlerPath: string, name: string): LoadedTool {
    return {
      name,
      description: `${name} test`,
      parameters: {},
      confirm: false,
      timeout: 5_000,
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

  function buildCtx(): CustomToolContext {
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
      setupState: {
        async read() {
          const row = await getSetupState(db, agentId, scopeId);
          if (!row) return null;
          return {
            state: row.state,
            completedAt: row.completedAt ? row.completedAt.toISOString() : null,
          };
        },
        async upsert(patch) {
          const row = await upsertSetupState(db, agentId, scopeId, patch);
          return {
            state: row.state,
            completedAt: row.completedAt ? row.completedAt.toISOString() : null,
          };
        },
        async markComplete() {
          const dt = await markComplete(db, agentId, scopeId);
          return dt ? dt.toISOString() : null;
        },
      },
    };
  }

  it('read returns null when no row exists', async () => {
    const result = await executor.execute(loadedTool(READ_HANDLER, 'read_setup_state'), {}, buildCtx());
    expect(result).toMatchObject({ok: true, row: null});
  });

  it('update creates a row from a sparse patch', async () => {
    const result = await executor.execute(
      loadedTool(UPDATE_HANDLER, 'update_setup_state'),
      {phase: 'installing'},
      buildCtx(),
    );
    expect(result).toMatchObject({
      ok: true,
      row: {state: {phase: 'installing'}, completedAt: null},
    });
  });

  it('read sees the row after update', async () => {
    const ctx = buildCtx();
    await executor.execute(
      loadedTool(UPDATE_HANDLER, 'update_setup_state'),
      {phase: 'connecting_required'},
      ctx,
    );
    const result = await executor.execute(loadedTool(READ_HANDLER, 'read_setup_state'), {}, ctx);
     
    const r = result as {row: {state: {phase: string}}};
    expect(r.row.state.phase).toBe('connecting_required');
  });

  it('appendCompleted concatenates across update calls', async () => {
    const ctx = buildCtx();
    await executor.execute(
      loadedTool(UPDATE_HANDLER, 'update_setup_state'),
      {
        phase: 'connecting_required',
        appendCompleted: [
          {
            slotLabel: 'Slack',
            packageName: '@amodalai/connection-slack',
            connectedAt: '2026-04-30T10:00:00Z',
            validatedAt: '2026-04-30T10:00:05Z',
            validationFormatted: 'Found 12 channels',
          },
        ],
      },
      ctx,
    );
    const second = await executor.execute(
      loadedTool(UPDATE_HANDLER, 'update_setup_state'),
      {
        appendCompleted: [
          {
            slotLabel: 'GA4',
            packageName: '@amodalai/connection-ga4',
            connectedAt: '2026-04-30T10:01:00Z',
            validatedAt: null,
            validationFormatted: null,
          },
        ],
      },
      ctx,
    );
     
    const r = second as {row: {state: {completed: Array<{slotLabel: string}>}}};
    expect(r.row.state.completed.map((s) => s.slotLabel)).toEqual(['Slack', 'GA4']);
  });

  it('mergeConfigAnswers merges keys server-side', async () => {
    const ctx = buildCtx();
    await executor.execute(
      loadedTool(UPDATE_HANDLER, 'update_setup_state'),
      {mergeConfigAnswers: {schedule: 'monday-8am'}},
      ctx,
    );
    const second = await executor.execute(
      loadedTool(UPDATE_HANDLER, 'update_setup_state'),
      {mergeConfigAnswers: {slackChannel: '#marketing'}},
      ctx,
    );
     
    const r = second as {row: {state: {configAnswers: Record<string, unknown>}}};
    expect(r.row.state.configAnswers).toEqual({
      schedule: 'monday-8am',
      slackChannel: '#marketing',
    });
  });

  it('rejects invalid phase with reason: invalid_patch', async () => {
    const result = await executor.execute(
      loadedTool(UPDATE_HANDLER, 'update_setup_state'),
      {phase: 'not_a_real_phase'},
      buildCtx(),
    );
    expect(result).toMatchObject({ok: false, reason: 'invalid_patch'});
  });

  it('rejects nested-object configAnswers values with reason: invalid_patch', async () => {
    const result = await executor.execute(
      loadedTool(UPDATE_HANDLER, 'update_setup_state'),
      {mergeConfigAnswers: {nested: {foo: 'bar'}}},
      buildCtx(),
    );
    expect(result).toMatchObject({ok: false, reason: 'invalid_patch'});
  });

  it('returns reason: no_db when ctx.setupState is absent', async () => {
    const ctxNoDb: CustomToolContext = {...buildCtx(), setupState: undefined};
    const result = await executor.execute(
      loadedTool(READ_HANDLER, 'read_setup_state'),
      {},
      ctxNoDb,
    );
    expect(result).toMatchObject({ok: false, reason: 'no_db'});
  });
});
