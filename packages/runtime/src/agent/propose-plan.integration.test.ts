/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

/**
 * Phase D integration test for `propose_plan` + `update_plan`. Pins
 * the agent-admin handlers end-to-end through the actual runtime
 * path: LocalToolExecutor compiles handler.ts via esbuild,
 * dynamic-imports the resulting .mjs, and runs each with a
 * CustomToolContext whose `emit` callback captures SSE events the
 * way the runtime's executing state would.
 *
 * Skips when the agent-admin cache (~/.amodal/admin-agent/latest/)
 * isn't populated.
 */

import {existsSync} from 'node:fs';
import {homedir} from 'node:os';
import * as path from 'node:path';

import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';

import type {CustomToolContext, CustomToolInlineEvent, LoadedTool} from '@amodalai/types';

import {LocalToolExecutor} from './tool-executor-local.js';

const ADMIN_AGENT_PATH = path.join(homedir(), '.amodal', 'admin-agent', 'latest');
const PROPOSE_HANDLER = path.join(ADMIN_AGENT_PATH, 'tools', 'propose_plan', 'handler.ts');
const UPDATE_HANDLER = path.join(ADMIN_AGENT_PATH, 'tools', 'update_plan', 'handler.ts');

const HAS_DEPS = existsSync(PROPOSE_HANDLER) && existsSync(UPDATE_HANDLER);
const describeWhenReady = HAS_DEPS ? describe : describe.skip;

describeWhenReady('propose_plan + update_plan (Phase D integration)', () => {
  let executor: LocalToolExecutor;
  let emitted: CustomToolInlineEvent[];

  beforeEach(() => {
    executor = new LocalToolExecutor();
    emitted = [];
  });

  afterEach(() => {
    executor.dispose();
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
      sessionId: 'sess_test',
      emit: (event) => {
        emitted.push(event);
      },
    };
  }

  it('propose_plan emits a proposal SSE event with the right shape', async () => {
    const result = await executor.execute(
      loadedTool(PROPOSE_HANDLER, 'propose_plan'),
      {
        summary: 'Plumbing scheduler + reminders',
        skills: [{label: 'Job Scheduler', description: 'Daily schedule via chat'}],
        requiredConnections: [{label: 'Twilio', description: 'SMS reminders'}],
        optionalConnections: [{label: 'Google Calendar', description: 'Sync'}],
      },
      buildCtx(),
    );

    expect(result).toMatchObject({ok: true});
    expect(emitted).toHaveLength(1);
    const event = emitted[0];
    expect(event.type).toBe('proposal');
    if (event.type !== 'proposal') throw new Error('unreachable');
    expect(event.summary).toBe('Plumbing scheduler + reminders');
    expect(event.skills[0]).toEqual({label: 'Job Scheduler', description: 'Daily schedule via chat'});
    expect(event.required_connections[0]?.label).toBe('Twilio');
    expect(event.optional_connections[0]?.label).toBe('Google Calendar');
    expect(event.proposal_id).toMatch(/^proposal_/);
  });

  it('propose_plan rejects empty summary with reason: invalid_params', async () => {
    const result = await executor.execute(
      loadedTool(PROPOSE_HANDLER, 'propose_plan'),
      {
        summary: '',
        skills: [],
        requiredConnections: [],
        optionalConnections: [],
      },
      buildCtx(),
    );
    expect(result).toMatchObject({ok: false, reason: 'invalid_params'});
    expect(emitted).toHaveLength(0);
  });

  it('propose_plan rejects malformed skill entries', async () => {
    const result = await executor.execute(
      loadedTool(PROPOSE_HANDLER, 'propose_plan'),
      {
        summary: 'x',
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- intentional bad input
        skills: [{label: 'No description'}] as any,
        requiredConnections: [],
        optionalConnections: [],
      },
      buildCtx(),
    );
    expect(result).toMatchObject({ok: false, reason: 'invalid_params'});
    expect(emitted).toHaveLength(0);
  });

  it('propose_plan returns no_emit when ctx.emit is absent', async () => {
    const ctxNoEmit: CustomToolContext = buildCtx();
    delete (ctxNoEmit as {emit?: unknown}).emit;
    const result = await executor.execute(
      loadedTool(PROPOSE_HANDLER, 'propose_plan'),
      {
        summary: 'x',
        skills: [],
        requiredConnections: [],
        optionalConnections: [],
      },
      ctxNoEmit,
    );
    expect(result).toMatchObject({ok: false, reason: 'no_emit'});
  });

  it('update_plan emits an update_plan SSE event with only the patched fields', async () => {
    const result = await executor.execute(
      loadedTool(UPDATE_HANDLER, 'update_plan'),
      {
        proposalId: 'proposal_abc',
        optionalConnections: [{label: 'QuickBooks', description: 'Invoicing'}],
      },
      buildCtx(),
    );
    expect(result).toMatchObject({ok: true, proposalId: 'proposal_abc'});
    expect(emitted).toHaveLength(1);
    const event = emitted[0];
    expect(event.type).toBe('update_plan');
    if (event.type !== 'update_plan') throw new Error('unreachable');
    expect(event.proposal_id).toBe('proposal_abc');
    // Only patched fields are emitted; unspecified ones must be omitted
    // so the widget reducer leaves them untouched.
    expect(event.optional_connections).toEqual([{label: 'QuickBooks', description: 'Invoicing'}]);
    expect(event.skills).toBeUndefined();
    expect(event.required_connections).toBeUndefined();
    expect(event.summary).toBeUndefined();
  });

  it('update_plan rejects empty proposalId', async () => {
    const result = await executor.execute(
      loadedTool(UPDATE_HANDLER, 'update_plan'),
      {proposalId: ''},
      buildCtx(),
    );
    expect(result).toMatchObject({ok: false, reason: 'invalid_params'});
  });

  it('update_plan accepts an empty array to clear a list', async () => {
    const result = await executor.execute(
      loadedTool(UPDATE_HANDLER, 'update_plan'),
      {proposalId: 'p1', optionalConnections: []},
      buildCtx(),
    );
    expect(result).toMatchObject({ok: true});
    const event = emitted[0];
    if (event.type !== 'update_plan') throw new Error('unreachable');
    expect(event.optional_connections).toEqual([]);
  });

  it('propose_plan generates unique proposalIds across calls', async () => {
    // Force time progression between calls so the suffix differs.
    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
    const r1 = await executor.execute(
      loadedTool(PROPOSE_HANDLER, 'propose_plan'),
      {
        summary: 'a',
        skills: [],
        requiredConnections: [],
        optionalConnections: [],
      },
      buildCtx(),
    );
    await sleep(5);
    const r2 = await executor.execute(
      loadedTool(PROPOSE_HANDLER, 'propose_plan'),
      {
        summary: 'b',
        skills: [],
        requiredConnections: [],
        optionalConnections: [],
      },
      buildCtx(),
    );

     
    const id1 = (r1 as {proposalId: string}).proposalId;
     
    const id2 = (r2 as {proposalId: string}).proposalId;
    expect(id1).not.toBe(id2);
  });

  it('update_plan returns no_emit when ctx.emit is absent', async () => {
    const ctxNoEmit: CustomToolContext = buildCtx();
    delete (ctxNoEmit as {emit?: unknown}).emit;
    const result = await executor.execute(
      loadedTool(UPDATE_HANDLER, 'update_plan'),
      {proposalId: 'p1'},
      ctxNoEmit,
    );
    expect(result).toMatchObject({ok: false, reason: 'no_emit'});
  });
});

// vi import is intentionally retained even when unused by individual cases:
// vitest's mock factory may be needed in the future for ctx variations.
 
void vi;
