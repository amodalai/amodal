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
import { existsSync as exists } from 'node:fs';
import { rm } from 'node:fs/promises';
import {
  getSetupState,
  upsertSetupState,
  markComplete,
  reconcileSetupState,
  deleteSetupState,
  deleteSetupStateByScope,
  deleteAgentSessionsByScope,
} from '@amodalai/db';
import type { Db } from '@amodalai/db';
import { commitSetup } from '@amodalai/runtime';
import { LocalFsBackend } from '@amodalai/runtime/tools';
import type { SetupPhase, SetupReadinessResult } from '@amodalai/types';

import { logger } from '../../lib/logger.js';
import { getAdminAgentUrl, getAgentId } from '../../lib/config.js';
import { getStudioDb } from '../../lib/db.js';
import { computeConnectionsStatus } from './connections-status.js';

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
  /**
   * Picker card data (title, tagline, platforms, thumbnailConversation).
   * When present, gets serialized into `providedContext._templateCard` so
   * the admin agent can call `show_preview` on the first turn with the
   * exact card the user clicked — they see what they picked rendered in
   * chat before installation kicks off.
   */
  templateCard?: unknown;
  /** The user's first message verbatim, used by Path B to seed planning. */
  userMessage?: string;
}

adminChatRoutes.post('/api/studio/admin-chat/start', async (c) => {
  let db: Db;
  try {
    db = await getStudioDb();
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

  // If a row already exists (resume), don't clobber state — but DO
  // run the H.11 server-side reconciliation pass so the agent's
  // first-turn read of `where am I?` reflects connections the user
  // configured out-of-band (per-connection page, manual `.env`
  // edits) since the last session. No-op when no plan is attached
  // or when nothing changed.
  const existing = await getSetupState(db, agentId, scopeId);
  if (existing) {
    // If the user clicked a *different* template card than the one this
    // setup_state row was started for, treat it as "starting over" —
    // delete the stale row and fall through to the seed-fresh path.
    // Otherwise the agent reads phase='connecting_required' for the OLD
    // template and tries to resume something the user already abandoned.
    const existingSlug = existing.state.providedContext['_templateSlug'];
    const requestedSlug = body.templateSlug;
    const slugChanged =
      source === 'template' &&
      typeof requestedSlug === 'string' &&
      requestedSlug.length > 0 &&
      typeof existingSlug === 'string' &&
      existingSlug !== requestedSlug;
    if (slugChanged) {
      logger.info('admin_chat_start_slug_changed', {
        agentId,
        scopeId,
        existingSlug,
        requestedSlug,
      });
      await deleteSetupState(db, agentId, scopeId);
    } else {
      let live = existing;
      try {
        const status = await computeConnectionsStatus();
        const reconciled = await reconcileSetupState(db, agentId, scopeId, status);
        if (reconciled) live = reconciled;
      } catch (err: unknown) {
        // Reconciliation failure shouldn't block the chat from starting —
        // worst case the agent sees a slightly stale state and the
        // client-side H.10 pass cleans up the visual cache.
        logger.warn('admin_chat_start_reconcile_failed', {
          error: err instanceof Error ? err.message : String(err),
        });
      }
      return c.json({
        ok: true,
        seeded: false,
        state: live.state,
        completedAt: live.completedAt ? live.completedAt.toISOString() : null,
      });
    }
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
  if (body.templateCard && typeof body.templateCard === 'object') {
    // Serialize the card data the user just clicked. Bounded length so
    // we don't blow up providedContext (the agent caps reads at a few KB
    // anyway). The agent JSON.parse's it on the first turn and feeds
    // the fields into show_preview verbatim.
    const serialized = JSON.stringify(body.templateCard);
    if (serialized.length <= 4_000) {
      providedContext['_templateCard'] = serialized;
    }
  }
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
// POST /api/studio/admin-chat/restart
//
// Wipe the in-progress setup so the user can start over. Always
// deletes the setup_state row. When `wipeFiles: true` is passed,
// also removes files install_template would have placed plus any
// runtime-issued secrets that were tied to that setup attempt:
//   - amodal.json, template.json (root manifests)
//   - package.json, package-lock.json, node_modules/ (npm artifacts)
//   - skills/, knowledge/, automations/, connections/, agents/,
//     tools/, pages/, evals/, stores/ (vendored template dirs)
//   - .amodal/secrets.env (OAuth tokens + paste-saved env-vars from
//     the previous attempt; stale ones could mask new auth issues)
// User-authored files outside this list (.git, .gitignore, .env,
// READMEs) are preserved.
// ---------------------------------------------------------------------------

const RESTART_WIPED_PATHS = [
  'amodal.json',
  'template.json',
  'package.json',
  'package-lock.json',
  'node_modules',
  'skills',
  'knowledge',
  'automations',
  'connections',
  'agents',
  'tools',
  'pages',
  'evals',
  'stores',
  '.amodal/secrets.env',
] as const;

adminChatRoutes.post('/api/studio/admin-chat/restart', async (c) => {
  let db: Db;
  try {
    db = await getStudioDb();
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    logger.warn('admin_chat_restart_no_db', { error: message });
    return c.json({ error: { code: 'NO_DB', message: 'DATABASE_URL is not set' } }, 503);
  }

  const rawBody: unknown = await c.req.json().catch(() => ({}));
  const body =
    typeof rawBody === 'object' && rawBody !== null
      ?  
        (rawBody as {wipeFiles?: unknown})
      : {};
  const wipeFiles = body.wipeFiles === true;

  const scopeId = DEFAULT_SCOPE_ID;

  // Wipe every setup_state row matching this scope, regardless of
  // agent_id. The agent_id env can shift between session start and
  // restart (CLI re-reads `amodal.json#name` on relaunch, which
  // install_template wrote mid-flow), so a strict
  // `(agent_id, scope_id)` filter would miss the original row.
  // Onboarding only ever has one row per scope, so a scope-only
  // wipe is safe and avoids the agent-id-mismatch trap.
  let setupRowsDeleted = 0;
  try {
    setupRowsDeleted = await deleteSetupStateByScope(db, scopeId);
  } catch (err: unknown) {
    logger.warn('admin_chat_restart_setup_state_wipe_failed', {
      error: err instanceof Error ? err.message : String(err),
    });
  }

  // Also wipe any agent_sessions rows for this scope. Chat history
  // lives there; without this, a stale session id resurrected via
  // somewhere we missed would replay old messages. The runtime's
  // session manager will create a fresh row on the next turn.
  let sessionRowsDeleted = 0;
  try {
    sessionRowsDeleted = await deleteAgentSessionsByScope(db, scopeId);
  } catch (err: unknown) {
    logger.warn('admin_chat_restart_sessions_wipe_failed', {
      error: err instanceof Error ? err.message : String(err),
    });
  }

  logger.info('admin_chat_restart', {
    scopeId,
    wipeFiles,
    setupRowsDeleted,
    sessionRowsDeleted,
  });

  const wiped: string[] = [];
  if (wipeFiles) {
    const repoPath = process.env[REPO_PATH_ENV_KEY];
    if (repoPath && exists(repoPath)) {
      for (const rel of RESTART_WIPED_PATHS) {
        const target = path.join(repoPath, rel);
        if (!exists(target)) continue;
        try {
          await rm(target, { recursive: true, force: true });
          wiped.push(rel);
        } catch (err: unknown) {
          logger.warn('admin_chat_restart_wipe_failed', {
            path: rel,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
    }
  }

  return c.json({ ok: true, wiped });
});

// ---------------------------------------------------------------------------
// Phase E.5 — POST /api/studio/admin-chat/check-completion
//
// Runs validateSetupReadiness against the live setup_state + (when
// available) the live env-var status. Returns {ready, warnings} for
// the warning-modal to render.
// ---------------------------------------------------------------------------

adminChatRoutes.post('/api/studio/admin-chat/check-completion', async (c) => {
  let db: Db;
  try {
    db = await getStudioDb();
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

  // Live env-var status from H.9 — lets validation rescue connections
  // the user configured out-of-band via the per-connection page that
  // never ended up in setup_state.completed[].
  const connectionsStatus = await computeConnectionsStatus();
  const result: SetupReadinessResult = validateSetupReadiness({
    state: row.state,
    plan: row.state.plan,
    connectionsStatus,
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
  let db: Db;
  try {
    db = await getStudioDb();
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
  const connectionsStatus = await computeConnectionsStatus();

  try {
    // commitSetup's `db` param is typed against the runtime's loose
    // `Record<string, unknown>` schema; getStudioDb() returns the
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
      connectionsStatus,
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
