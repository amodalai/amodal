/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

/**
 * Phase E.2 integration test for `commitSetup`. Runs against a real
 * Postgres + a real `LocalFsBackend` over a temp repo so the
 * file-then-DB ordering, idempotency, and validation gating all get
 * exercised end-to-end.
 *
 * Skips when DATABASE_URL is not set (same pattern as the Phase B
 * setup-state.test.ts).
 */

import {randomUUID} from 'node:crypto';
import {mkdtemp, readFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import * as path from 'node:path';

import {afterAll, afterEach, beforeAll, beforeEach, describe, expect, it} from 'vitest';

import {
  closeDb,
  ensureSchema,
  getDb,
  upsertSetupState,
  type Db,
} from '@amodalai/db';
import type {SetupPlan} from '@amodalai/types';

import {LocalFsBackend} from '../tools/fs/local.js';
import {commitSetup, composeAmodalJson} from './commit-setup.js';

const HAS_DB = Boolean(process.env['DATABASE_URL']);
const describeWhenDb = HAS_DB ? describe : describe.skip;

function makePlan(overrides?: Partial<SetupPlan>): SetupPlan {
  return {
    templatePackage: '@amodalai/test-template',
    slots: [],
    config: [],
    completion: {
      title: 'Test Agent',
      suggestions: [],
      automationTitle: null,
    },
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

describeWhenDb('commitSetup (Phase E.2 integration)', () => {
  let db: Db;
  let repoRoot: string;
  let fs: LocalFsBackend;
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
    repoRoot = await mkdtemp(path.join(tmpdir(), 'commit-setup-'));
    fs = new LocalFsBackend({repoRoot});
    agentId = `agent_${randomUUID()}`;
  });

  afterEach(async () => {
    // Clean DB row + temp repo so reruns stay isolated.
    try {
      const {deleteSetupState} = await import('@amodalai/db');
      await deleteSetupState(db, agentId, scopeId);
    } catch {
      // Ignore — best-effort cleanup.
    }
    await rm(repoRoot, {recursive: true, force: true});
  });

  it('returns no_state when no setup_state row exists', async () => {
    const result = await commitSetup({db, fs, agentId, scopeId});
    expect(result).toMatchObject({ok: false, reason: 'no_state'});
  });

  it('returns not_ready when a required slot is missing', async () => {
    await upsertSetupState(db, agentId, scopeId, {
      phase: 'configuring',
      plan: makePlan({slots: [slackSlot]}),
    });

    const result = await commitSetup({db, fs, agentId, scopeId});
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.reason).toBe('not_ready');
    if (result.reason !== 'not_ready') throw new Error('unreachable');
    expect(result.warnings[0]?.kind).toBe('missing_required_slot');
  });

  it('commits when required slots are satisfied — writes amodal.json + marks completed_at', async () => {
    await upsertSetupState(db, agentId, scopeId, {
      phase: 'configuring',
      plan: makePlan({
        slots: [slackSlot],
        completion: {title: 'Marketing Digest', suggestions: [], automationTitle: 'Weekly digest'},
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

    const result = await commitSetup({db, fs, agentId, scopeId});
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    expect(result.alreadyComplete).toBe(false);
    expect(result.completedAt).toBeInstanceOf(Date);

    // amodal.json was written with the right content.
    const written = await readFile(path.join(repoRoot, 'amodal.json'), 'utf-8');
    const parsed = JSON.parse(written) as {name: string; version: string; packages?: string[]};
    expect(parsed.name).toBe('marketing-digest');
    expect(parsed.version).toBe('1.0.0');
    expect(parsed.packages).toContain('@amodalai/test-template');
    expect(parsed.packages).toContain('@amodalai/connection-slack');
  });

  it('is idempotent — second commit returns alreadyComplete: true with the same timestamp', async () => {
    await upsertSetupState(db, agentId, scopeId, {
      phase: 'configuring',
      plan: makePlan(),
    });
    const r1 = await commitSetup({db, fs, agentId, scopeId});
    expect(r1.ok).toBe(true);
    if (!r1.ok) throw new Error('unreachable');

    const r2 = await commitSetup({db, fs, agentId, scopeId});
    expect(r2.ok).toBe(true);
    if (!r2.ok) throw new Error('unreachable');
    expect(r2.alreadyComplete).toBe(true);
    expect(r2.completedAt.getTime()).toBe(r1.completedAt.getTime());
  });

  it('force: true commits even with missing required slots', async () => {
    await upsertSetupState(db, agentId, scopeId, {
      phase: 'configuring',
      plan: makePlan({slots: [slackSlot]}),
    });

    const result = await commitSetup({db, fs, agentId, scopeId, force: true});
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');

    // amodal.json was still written even without the Slack connection
    // — this is the "user said skip Slack and finish anyway" path.
    const written = await readFile(path.join(repoRoot, 'amodal.json'), 'utf-8');
    expect(written.length).toBeGreaterThan(0);
  });

  it('returns not_ready with a clear warning when no Plan is attached', async () => {
    // Edge case: row exists (from update_setup_state seeding planning
    // phase) but no Plan ever got attached.
    await upsertSetupState(db, agentId, scopeId, {phase: 'planning'});
    const result = await commitSetup({db, fs, agentId, scopeId});
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.reason).toBe('not_ready');
  });

  it('does not write amodal.json when readiness fails', async () => {
    await upsertSetupState(db, agentId, scopeId, {
      phase: 'configuring',
      plan: makePlan({slots: [slackSlot]}),
    });

    const result = await commitSetup({db, fs, agentId, scopeId});
    expect(result.ok).toBe(false);

    // The temp repo is fresh — no amodal.json should have been
    // written when readiness blocked the commit.
    await expect(readFile(path.join(repoRoot, 'amodal.json'), 'utf-8')).rejects.toThrow();
  });

  it('survives a concurrent double-commit: first wins, second sees alreadyComplete', async () => {
    // Phase E.2 risk from the build plan: "Agent fires
    // request_complete_setup at the same instant the user clicks
    // Finish setup. Both reach commit_setup; first acquires the
    // row lock and writes; second sees completed_at IS NOT NULL
    // and returns alreadyComplete: true. Test this explicitly
    // with two parallel HTTP calls."
    await upsertSetupState(db, agentId, scopeId, {
      phase: 'configuring',
      plan: makePlan(),
    });

    const [r1, r2] = await Promise.all([
      commitSetup({db, fs, agentId, scopeId}),
      commitSetup({db, fs, agentId, scopeId}),
    ]);

    // Both succeed.
    expect(r1.ok).toBe(true);
    expect(r2.ok).toBe(true);
    if (!r1.ok || !r2.ok) throw new Error('unreachable');

    // Exactly one was the canonical write; the other reports
    // alreadyComplete: true. Both report the same timestamp
    // (the second is reading the row the first wrote).
    const canonical = r1.alreadyComplete ? r2 : r1;
    const followUp = r1.alreadyComplete ? r1 : r2;
    expect(canonical.alreadyComplete).toBe(false);
    expect(followUp.alreadyComplete).toBe(true);
    expect(canonical.completedAt.getTime()).toBe(followUp.completedAt.getTime());

    // The amodal.json that landed is well-formed (only one writer
    // — the second branch early-returned before writing).
    const written = await readFile(path.join(repoRoot, 'amodal.json'), 'utf-8');
    const parsed = JSON.parse(written) as {name: string; version: string};
    expect(parsed.name).toBeTruthy();
    expect(parsed.version).toBeTruthy();
  });

  it('concurrent commits with one force=true still resolve idempotently', async () => {
    // Edge case: the agent calls request_complete_setup (force:
    // false) at the same time the user clicks Finish anyway
    // (force: true). Whichever lands first wins; the other
    // returns alreadyComplete: true. Force flag is irrelevant
    // post-completion since completedAt is already set.
    await upsertSetupState(db, agentId, scopeId, {
      phase: 'configuring',
      plan: makePlan(),
    });

    const [r1, r2] = await Promise.all([
      commitSetup({db, fs, agentId, scopeId, force: false}),
      commitSetup({db, fs, agentId, scopeId, force: true}),
    ]);

    expect(r1.ok).toBe(true);
    expect(r2.ok).toBe(true);
    if (!r1.ok || !r2.ok) throw new Error('unreachable');
    expect(r1.completedAt.getTime()).toBe(r2.completedAt.getTime());
  });
});

describe('composeAmodalJson (unit)', () => {
  it('builds a config from name + packages with template first', () => {
    const config = composeAmodalJson(
      {
        phase: 'configuring',
        currentStep: null,
        completed: [
          {
            slotLabel: 'Slack',
            packageName: '@amodalai/connection-slack',
            connectedAt: '2026-04-30T10:00:00Z',
            validatedAt: '2026-04-30T10:00:05Z',
            validationFormatted: 'Found 12',
          },
        ],
        skipped: [],
        configAnswers: {},
        deferredRequests: [],
        providedContext: {},
        plan: makePlan({
          templatePackage: '@amodalai/marketing-ops',
          completion: {title: 'Marketing Ops', suggestions: [], automationTitle: null},
        }),
      },
      makePlan({
        templatePackage: '@amodalai/marketing-ops',
        completion: {title: 'Marketing Ops', suggestions: [], automationTitle: null},
      }),
    );
    expect(config.name).toBe('marketing-ops');
    expect(config.packages).toEqual(['@amodalai/marketing-ops', '@amodalai/connection-slack']);
  });

  it('falls back to "agent" when the completion title is empty', () => {
    const config = composeAmodalJson(
      {
        phase: 'configuring',
        currentStep: null,
        completed: [],
        skipped: [],
        configAnswers: {},
        deferredRequests: [],
        providedContext: {},
        plan: null,
      },
      null,
    );
    expect(config.name).toBe('agent');
    expect(config.packages).toBeUndefined();
  });

  it('dedupes packages across the template + completed list', () => {
    const config = composeAmodalJson(
      {
        phase: 'configuring',
        currentStep: null,
        completed: [
          {
            slotLabel: 'Slack',
            packageName: '@amodalai/connection-slack',
            connectedAt: 'x',
            validatedAt: null,
            validationFormatted: null,
          },
          {
            slotLabel: 'Slack DM',
            packageName: '@amodalai/connection-slack',
            connectedAt: 'x',
            validatedAt: null,
            validationFormatted: null,
          },
        ],
        skipped: [],
        configAnswers: {},
        deferredRequests: [],
        providedContext: {},
        plan: makePlan({templatePackage: '@amodalai/connection-slack'}),
      },
      makePlan({templatePackage: '@amodalai/connection-slack'}),
    );
    // Single occurrence even though it appeared 3 times across template + completed.
    expect(config.packages).toEqual(['@amodalai/connection-slack']);
  });
});
