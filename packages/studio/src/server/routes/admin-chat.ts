/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import { Hono } from 'hono';
import { stream } from 'hono/streaming';
import { existsSync } from 'node:fs';
import * as path from 'node:path';

import { validateSetupReadiness } from '@amodalai/core';
import {
  getDb,
  getSetupState,
  upsertSetupState,
  markComplete,
} from '@amodalai/db';
import { commitSetup } from '@amodalai/runtime';
import { LocalFsBackend } from '@amodalai/runtime/tools';
import type { SetupPhase, SetupReadinessResult } from '@amodalai/types';

import { logger } from '../../lib/logger.js';
import { getAdminAgentUrl, getAgentId } from '../../lib/config.js';

const ADMIN_CHAT_TIMEOUT_MS = 300_000;
const REPO_PATH_ENV_KEY = 'REPO_PATH';
const AMODAL_JSON = 'amodal.json';
const DEFAULT_SCOPE_ID = '';

export const adminChatRoutes = new Hono();

adminChatRoutes.post('/api/studio/admin-chat/stream', async (c) => {
  const adminUrl = getAdminAgentUrl();
  if (!adminUrl) {
    return c.json(
      { error: { code: 'ADMIN_AGENT_NOT_CONFIGURED', message: 'Admin agent not configured' } },
      503,
    );
  }

  const body = await c.req.json();

  let upstream: Response;
  try {
    upstream = await fetch(`${adminUrl}/chat/stream`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(ADMIN_CHAT_TIMEOUT_MS),
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error('admin_chat_fetch_error', { error: message });
    return c.json(
      { error: { code: 'ADMIN_AGENT_UNREACHABLE', message: 'Failed to reach admin agent' } },
      502,
    );
  }

  if (!upstream.ok) {
    if (upstream.body) {
      return stream(c, async (s) => {
        const reader = upstream.body!.getReader();
        try {
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            await s.write(value);
          }
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : String(err);
          logger.warn('admin_chat_upstream_read_error', { error: message });
        }
      });
    }
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- upstream HTTP status is always valid
    return c.body(null, upstream.status as import('hono/utils/http-status').ContentfulStatusCode);
  }

  c.header('Content-Type', upstream.headers.get('Content-Type') ?? 'text/event-stream');
  c.header('Cache-Control', 'no-cache, no-transform');

  if (upstream.body) {
    return stream(c, async (s) => {
      const reader = upstream.body!.getReader();
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          await s.write(value);
        }
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        logger.warn('admin_chat_pump_error', { error: message });
      }
    });
  }

  return c.body(null, 200);
});

// ---------------------------------------------------------------------------
// Phase E.12 — POST /api/studio/admin-chat/start
//
// Seed the initial setup_state row before the first chat turn so the
// admin agent already has its bearings when it reads state. Path A
// (template clicked) seeds {phase: 'installing', plan: <templateSlug>};
// Path B (custom description) seeds {phase: 'planning'} and the
// agent's first turn drafts the proposal.
//
// Also runs the E.8 auto-recovery: when amodal.json exists in the
// repo but completed_at is null in setup_state (the runtime crashed
// between commitSetup's file write and the markComplete in DB), we
// finalize the DB before returning.
// ---------------------------------------------------------------------------

interface AdminChatStartBody {
  source: 'template' | 'custom' | 'questionnaire';
  templateSlug?: string;
  /** The user's first message verbatim, used by Path B to seed planning. */
  userMessage?: string;
}

adminChatRoutes.post('/api/studio/admin-chat/start', async (c) => {
  let db: ReturnType<typeof getDb>;
  try {
    db = getDb();
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    logger.warn('admin_chat_start_no_db', { error: message });
    return c.json({ error: { code: 'NO_DB', message: 'DATABASE_URL is not set' } }, 503);
  }

  const rawBody: unknown = await c.req.json().catch(() => ({}));
  const body: Partial<AdminChatStartBody> =
    typeof rawBody === 'object' && rawBody !== null
       
      ? (rawBody as Partial<AdminChatStartBody>)
      : {};
  const source = body.source ?? 'custom';
  const agentId = getAgentId();
  const scopeId = DEFAULT_SCOPE_ID;

  // E.8 auto-recovery — file-then-DB ordering in commit_setup means a
  // crash mid-commit leaves amodal.json on disk but completed_at null.
  // Finalize the DB before seeding any new state.
  const repoPath = process.env[REPO_PATH_ENV_KEY];
  if (repoPath && existsSync(path.join(repoPath, AMODAL_JSON))) {
    const existing = await getSetupState(db, agentId, scopeId);
    if (existing && existing.completedAt === null) {
      logger.info('admin_chat_start_auto_recover', { agentId, scopeId });
      await markComplete(db, agentId, scopeId);
    }
  }

  // If a row already exists (resume), don't clobber state — just
  // return the live row.
  const existing = await getSetupState(db, agentId, scopeId);
  if (existing) {
    return c.json({
      ok: true,
      seeded: false,
      state: existing.state,
      completedAt: existing.completedAt ? existing.completedAt.toISOString() : null,
    });
  }

  // Seed a fresh row.
  const phase: SetupPhase = source === 'template' ? 'installing' : 'planning';
  const seedPatch: {
    phase: SetupPhase;
    mergeProvidedContext?: Record<string, string>;
  } = { phase };
  // Stash entry-path context so the agent can branch on it without
  // re-deriving from chat history. Phase B/D rules already key off
  // state.providedContext for "what did the user say up front?".
  const providedContext: Record<string, string> = {};
  if (source) providedContext['_setupSource'] = source;
  if (body.templateSlug) providedContext['_templateSlug'] = body.templateSlug;
  if (body.userMessage) providedContext['_seedMessage'] = body.userMessage.slice(0, 1000);
  if (Object.keys(providedContext).length > 0) {
    seedPatch.mergeProvidedContext = providedContext;
  }

  const fresh = await upsertSetupState(db, agentId, scopeId, seedPatch);
  return c.json({
    ok: true,
    seeded: true,
    state: fresh.state,
    completedAt: fresh.completedAt ? fresh.completedAt.toISOString() : null,
  });
});

// ---------------------------------------------------------------------------
// Phase E.5 — POST /api/studio/admin-chat/check-completion
//
// Runs validateSetupReadiness against the live setup_state + (when
// available) the live env-var status. Returns {ready, warnings} for
// the warning-modal to render.
// ---------------------------------------------------------------------------

adminChatRoutes.post('/api/studio/admin-chat/check-completion', async (c) => {
  let db: ReturnType<typeof getDb>;
  try {
    db = getDb();
  } catch {
    return c.json({ error: { code: 'NO_DB', message: 'DATABASE_URL is not set' } }, 503);
  }

  const agentId = getAgentId();
  const scopeId = DEFAULT_SCOPE_ID;

  const row = await getSetupState(db, agentId, scopeId);
  if (!row) {
    return c.json({
      ok: false,
      reason: 'no_state',
      message: 'No setup_state row exists yet — agent has not started a setup conversation.',
    }, 404);
  }
  if (row.completedAt) {
    return c.json({
      ok: true,
      ready: true,
      warnings: [],
      alreadyComplete: true,
      completedAt: row.completedAt.toISOString(),
    });
  }
  if (!row.state.plan) {
    return c.json({
      ok: true,
      ready: false,
      warnings: [
        {
          kind: 'missing_required_slot',
          severity: 'block',
          target: '<plan>',
          message: 'No Plan attached yet — confirm a template or proposal first.',
        },
      ],
      alreadyComplete: false,
    });
  }

  const result: SetupReadinessResult = validateSetupReadiness({
    state: row.state,
    plan: row.state.plan,
    // Phase H.9's /api/connections-status feeds in here once it ships.
  });
  return c.json({
    ok: true,
    ready: result.ready,
    warnings: result.warnings,
    alreadyComplete: false,
  });
});

// ---------------------------------------------------------------------------
// Phase E.5 — POST /api/studio/admin-chat/commit-setup
//
// User-button's commit path. Accepts {force?: boolean}; mirrors the
// agent's request_complete_setup / force_complete_setup tools by
// calling the same commitSetup primitive.
// ---------------------------------------------------------------------------

interface CommitSetupBody {
  force?: boolean;
}

adminChatRoutes.post('/api/studio/admin-chat/commit-setup', async (c) => {
  const repoPath = process.env[REPO_PATH_ENV_KEY];
  if (!repoPath) {
    return c.json({ error: { code: 'NO_REPO', message: 'REPO_PATH is not set' } }, 503);
  }
  let db: ReturnType<typeof getDb>;
  try {
    db = getDb();
  } catch {
    return c.json({ error: { code: 'NO_DB', message: 'DATABASE_URL is not set' } }, 503);
  }

  const rawBody: unknown = await c.req.json().catch(() => ({}));
  const body: Partial<CommitSetupBody> =
    typeof rawBody === 'object' && rawBody !== null
       
      ? (rawBody as Partial<CommitSetupBody>)
      : {};
  const agentId = getAgentId();
  const scopeId = DEFAULT_SCOPE_ID;
  const fs = new LocalFsBackend({ repoRoot: repoPath });

  try {
    // commitSetup's `db` param is typed against the runtime's loose
    // `Record<string, unknown>` schema; getDb() returns the
    // schema-typed Drizzle handle. Same NodePgDatabase at runtime —
    // the variance is a TS-only artifact of Drizzle's generic schema.
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- cross-package Drizzle generic variance
    const looseDb = db as unknown as Parameters<typeof commitSetup>[0]['db'];
    const result = await commitSetup({
      db: looseDb,
      fs,
      agentId,
      scopeId,
      force: body.force === true,
    });
    if (result.ok) {
      return c.json({
        ok: true,
        alreadyComplete: result.alreadyComplete,
        completedAt: result.completedAt.toISOString(),
      });
    }
    if (result.reason === 'not_ready') {
      return c.json({ ok: false, reason: 'not_ready', warnings: result.warnings });
    }
    return c.json({ ok: false, reason: 'no_state', message: result.message }, 404);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error('admin_chat_commit_failed', { error: message, agentId });
    return c.json({ ok: false, reason: 'error', message }, 500);
  }
});
