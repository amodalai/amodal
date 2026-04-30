/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

/**
 * Integration test for the `setup_state` query module — Phase B.
 *
 * Runs against a real Postgres when `DATABASE_URL` is set in the test
 * env (the same env `amodal dev` uses). When the var is missing the
 * suite is skipped — keeps `pnpm test` clean for contributors who
 * haven't set up a local Postgres yet but still gives CI a way to
 * exercise the JSONB merge semantics that mocking can't.
 *
 * Each test runs in an isolated row keyed by a random `(agentId,
 * scopeId)` pair, with cleanup in `afterEach` so concurrent runs
 * don't collide.
 */

import {randomUUID} from 'node:crypto';

import {afterAll, afterEach, beforeAll, beforeEach, describe, expect, it} from 'vitest';
import {and, eq} from 'drizzle-orm';

import {getDb, closeDb, type Db} from '../connection.js';
import {ensureSchema} from '../migrate.js';
import {
  getSetupState,
  upsertSetupState,
  markComplete,
} from '../queries/setup-state.js';
import {setupState} from '../schema/setup-state.js';

const HAS_DB = Boolean(process.env['DATABASE_URL']);
const describeWhenDb = HAS_DB ? describe : describe.skip;

describeWhenDb('setup-state queries (integration)', () => {
  let db: Db;
  let agentId: string;
  let scopeId: string;

  beforeAll(async () => {
    db = getDb();
    await ensureSchema(db);
  });

  afterAll(async () => {
    await closeDb();
  });

  beforeEach(() => {
    // Generate fresh identity per-test so concurrent runs don't collide.
    agentId = `agent_${randomUUID()}`;
    scopeId = '';
  });

  afterEach(async () => {
    if (agentId && scopeId !== undefined) {
      await db.delete(setupState).where(
        and(eq(setupState.agentId, agentId), eq(setupState.scopeId, scopeId)),
      );
    }
  });

  it('returns null when no row exists', async () => {
    const result = await getSetupState(db, agentId, scopeId);
    expect(result).toBeNull();
  });

  it('upsert creates a row from empty seed when patch is sparse', async () => {
    const fresh = await upsertSetupState(db, agentId, scopeId, {phase: 'installing'});
    expect(fresh.state.phase).toBe('installing');
    expect(fresh.state.completed).toEqual([]);
    expect(fresh.state.skipped).toEqual([]);
    expect(fresh.state.configAnswers).toEqual({});
    expect(fresh.completedAt).toBeNull();
  });

  it('appendCompleted concatenates across two calls', async () => {

    await upsertSetupState(db, agentId, scopeId, {
      phase: 'connecting_required',
      appendCompleted: [
        {
          slotLabel: 'CRM',
          packageName: '@amodalai/connection-hubspot',
          connectedAt: '2026-04-30T10:00:00Z',
          validatedAt: null,
          validationFormatted: null,
        },
      ],
    });
    const after = await upsertSetupState(db, agentId, scopeId, {
      appendCompleted: [
        {
          slotLabel: 'Slack',
          packageName: '@amodalai/connection-slack',
          connectedAt: '2026-04-30T10:01:00Z',
          validatedAt: '2026-04-30T10:01:05Z',
          validationFormatted: 'Found 12 channels',
        },
      ],
    });

    expect(after.state.completed).toHaveLength(2);
    expect(after.state.completed[0].slotLabel).toBe('CRM');
    expect(after.state.completed[1].slotLabel).toBe('Slack');
    expect(after.state.completed[1].validationFormatted).toBe('Found 12 channels');
  });

  it('mergeConfigAnswers merges keys server-side without losing prior keys', async () => {

    await upsertSetupState(db, agentId, scopeId, {
      mergeConfigAnswers: {schedule: 'monday-8am'},
    });
    const after = await upsertSetupState(db, agentId, scopeId, {
      mergeConfigAnswers: {slackChannel: '#marketing'},
    });
    expect(after.state.configAnswers).toEqual({
      schedule: 'monday-8am',
      slackChannel: '#marketing',
    });
  });

  it('overwrites a config answer when the same key is sent again', async () => {

    await upsertSetupState(db, agentId, scopeId, {
      mergeConfigAnswers: {schedule: 'monday-8am'},
    });
    const after = await upsertSetupState(db, agentId, scopeId, {
      mergeConfigAnswers: {schedule: 'friday-4pm'},
    });
    expect(after.state.configAnswers).toEqual({schedule: 'friday-4pm'});
  });

  it('phase update overrides without disturbing list fields', async () => {

    await upsertSetupState(db, agentId, scopeId, {
      phase: 'connecting_required',
      appendCompleted: [
        {
          slotLabel: 'CRM',
          packageName: '@amodalai/connection-hubspot',
          connectedAt: '2026-04-30T10:00:00Z',
          validatedAt: null,
          validationFormatted: null,
        },
      ],
    });
    const after = await upsertSetupState(db, agentId, scopeId, {phase: 'configuring'});
    expect(after.state.phase).toBe('configuring');
    expect(after.state.completed).toHaveLength(1);
  });

  it('plan: null is distinct from plan: undefined', async () => {
    await upsertSetupState(db, agentId, scopeId, {
      plan: {
        templatePackage: '@amodalai/test-template',
        slots: [],
        config: [],
        completion: {title: 'Draft Plan', suggestions: [], automationTitle: null},
      },
    });
    const cleared = await upsertSetupState(db, agentId, scopeId, {plan: null});
    expect(cleared.state.plan).toBeNull();
  });

  it('markComplete stamps completedAt + flips phase to complete', async () => {

    await upsertSetupState(db, agentId, scopeId, {phase: 'configuring'});
    const completedAt = await markComplete(db, agentId, scopeId);
    expect(completedAt).toBeInstanceOf(Date);

    const fresh = await getSetupState(db, agentId, scopeId);
    expect(fresh?.state.phase).toBe('complete');
    expect(fresh?.completedAt).toEqual(completedAt);
  });

  it('markComplete is idempotent', async () => {

    await upsertSetupState(db, agentId, scopeId, {phase: 'configuring'});
    const first = await markComplete(db, agentId, scopeId);
    const second = await markComplete(db, agentId, scopeId);
    expect(second?.getTime()).toBe(first?.getTime());
  });

  it('markComplete returns null for a missing row', async () => {

    const result = await markComplete(db, agentId, scopeId);
    expect(result).toBeNull();
  });
});
