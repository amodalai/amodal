/**
 * @license
 * Copyright 2025 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

/**
 * PGLite-backed StudioBackend for local dev (`amodal dev`).
 *
 * Uses in-process WASM Postgres via `@electric-sql/pglite`. Drafts are stored
 * in a single `studio_drafts` table keyed by `(user_id, file_path)`; publish
 * writes draft contents directly to the local repository filesystem because
 * local dev does not have a GitHub App / git commit pipeline.
 *
 * Constructor takes either a pre-built `PGlite` instance (useful for tests
 * sharing an in-memory db) or a `dataDir` string that `init()` will use to
 * construct one. `repoPath` is required because `publish()` writes into it.
 *
 * Lifecycle: call `init()` once before using the backend, or let the first
 * mutating operation lazy-init. Callers that want deterministic startup
 * (e.g. `amodal dev` boot) should `await backend.init()` explicitly.
 *
 * The class implements the `StudioBackend` interface from `backend.ts`
 * unchanged — `init()` is an extra method on the concrete class, not on the
 * interface.
 */

import {randomBytes} from 'node:crypto';
import {mkdir, writeFile} from 'node:fs/promises';
import {dirname, isAbsolute, join, normalize, resolve, sep} from 'node:path';

import {log as defaultLogger} from '@amodalai/core';
import type {Logger} from '@amodalai/core';
import type {PGlite} from '@electric-sql/pglite';

import type {
  DraftFile,
  PreviewResult,
  PublishResult,
  StudioBackend,
} from '../backend.js';
import {
  StudioFeatureUnavailableError,
  StudioPublishError,
  StudioStorageError,
} from '../errors.js';

/**
 * DDL for the single drafts table. `CREATE TABLE IF NOT EXISTS` lets `init()`
 * run safely on every startup. The Drizzle cloud backend in PR 2.3 will match
 * this exact shape so the contract tests pass against both.
 */
const CREATE_TABLE_DDL = `
  CREATE TABLE IF NOT EXISTS studio_drafts (
    user_id    TEXT        NOT NULL,
    file_path  TEXT        NOT NULL,
    content    TEXT        NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (user_id, file_path)
  );
`;

// Prepared statements as module constants to avoid magic SQL strings sprinkled
// through the methods. PGlite supports `$1`-style positional parameters.
const SQL_SELECT_DRAFT =
  'SELECT content FROM studio_drafts WHERE user_id = $1 AND file_path = $2';
const SQL_UPSERT_DRAFT = `
  INSERT INTO studio_drafts (user_id, file_path, content, updated_at)
  VALUES ($1, $2, $3, NOW())
  ON CONFLICT (user_id, file_path)
  DO UPDATE SET content = EXCLUDED.content, updated_at = NOW()
`;
const SQL_DELETE_DRAFT =
  'DELETE FROM studio_drafts WHERE user_id = $1 AND file_path = $2';
const SQL_LIST_DRAFTS =
  'SELECT file_path, content, updated_at FROM studio_drafts WHERE user_id = $1';
const SQL_DISCARD_ALL =
  'DELETE FROM studio_drafts WHERE user_id = $1';

/**
 * Constructor options for `PGLiteStudioBackend`.
 *
 * Exactly one of `pglite` or `dataDir` may be supplied. If neither is given,
 * `init()` creates an in-memory PGlite instance (useful for tests).
 */
export interface PGLiteStudioBackendOptions {
  /**
   * Absolute path to the agent's local git repository root. `publish()`
   * resolves draft paths relative to this directory before writing to disk.
   */
  repoPath: string;

  /**
   * Pre-constructed PGlite instance. When provided, the backend does not own
   * the lifecycle and will not close it in its own `close()` call.
   */
  pglite?: PGlite;

  /**
   * Filesystem path for the pglite database. When provided (and `pglite` is
   * not), `init()` creates a PGlite instance backed by this directory and
   * owns its lifecycle.
   */
  dataDir?: string;

  /**
   * Optional structured logger. Defaults to the core `log` singleton so that
   * every tool call, state transition, and error still emits a structured
   * event per the engineering standards.
   */
  logger?: Logger;
}

// Shape of a studio_drafts row as returned by pglite (all columns selected).
interface DraftRow {
  file_path: string;
  content: string;
  updated_at: Date | string;
}

// Shape of a single-column content select.
interface ContentRow {
  content: string;
}

export class PGLiteStudioBackend implements StudioBackend {
  private readonly repoPath: string;
  private readonly logger: Logger;
  private readonly dataDir: string | undefined;
  private readonly ownsPglite: boolean;
  private pglite: PGlite | null;
  private initialized = false;
  private initPromise: Promise<void> | null = null;

  constructor(options: PGLiteStudioBackendOptions) {
    if (!options.repoPath) {
      throw new StudioStorageError(
        'construct',
        new Error('PGLiteStudioBackend requires a repoPath'),
      );
    }
    if (options.pglite && options.dataDir) {
      throw new StudioStorageError(
        'construct',
        new Error(
          'PGLiteStudioBackend: supply exactly one of pglite or dataDir, not both',
        ),
      );
    }
    this.repoPath = resolve(options.repoPath);
    this.logger = (options.logger ?? defaultLogger).child({
      module: 'studio.pglite',
    });
    this.dataDir = options.dataDir;
    this.pglite = options.pglite ?? null;
    this.ownsPglite = options.pglite === undefined;
  }

  /**
   * Lazily create the PGlite instance (if the caller didn't inject one) and
   * run the one-time `CREATE TABLE IF NOT EXISTS`. Safe to call multiple
   * times — subsequent calls are no-ops. Concurrent first-call invocations
   * share the same in-flight promise so the DDL only runs once.
   */
  async init(): Promise<void> {
    if (this.initialized) return;
    if (this.initPromise) {
      await this.initPromise;
      return;
    }
    this.initPromise = this.doInit();
    try {
      await this.initPromise;
    } finally {
      this.initPromise = null;
    }
  }

  private async doInit(): Promise<void> {
    try {
      if (!this.pglite) {
        if (this.dataDir) {
          const {mkdirSync} = await import('node:fs');
          mkdirSync(this.dataDir, {recursive: true});
        }
        const {PGlite} = await import('@electric-sql/pglite');
        this.pglite = new PGlite(this.dataDir ?? undefined);
      }
      await this.pglite.exec(CREATE_TABLE_DDL);
      this.initialized = true;
      this.logger.info('studio_pglite_initialized', {
        dataDir: this.dataDir ?? '(in-memory)',
        repoPath: this.repoPath,
      });
    } catch (err) {
      this.logger.error('studio_pglite_init_failed', {
        error: err instanceof Error ? err.message : String(err),
      });
      throw new StudioStorageError('init', err);
    }
  }

  private async ensureReady(): Promise<PGlite> {
    if (!this.initialized) {
      await this.init();
    }
    if (!this.pglite) {
      throw new StudioStorageError(
        'ensureReady',
        new Error('PGlite instance missing after init'),
      );
    }
    return this.pglite;
  }

  async getDraft(userId: string, filePath: string): Promise<string | null> {
    const db = await this.ensureReady();
    try {
      const result = await db.query<ContentRow>(SQL_SELECT_DRAFT, [
        userId,
        filePath,
      ]);
      if (result.rows.length === 0) {
        return null;
      }
      // Non-null assertion is safe: length check above.
      return result.rows[0].content;
    } catch (err) {
      this.logger.error('studio_get_draft_failed', {
        userId: redactUser(userId),
        filePath,
        error: err instanceof Error ? err.message : String(err),
      });
      throw new StudioStorageError('getDraft', err);
    }
  }

  async setDraft(
    userId: string,
    filePath: string,
    content: string,
  ): Promise<void> {
    const db = await this.ensureReady();
    try {
      await db.query(SQL_UPSERT_DRAFT, [userId, filePath, content]);
      this.logger.info('studio_set_draft', {
        userId: redactUser(userId),
        filePath,
        size: content.length,
      });
    } catch (err) {
      this.logger.error('studio_set_draft_failed', {
        userId: redactUser(userId),
        filePath,
        error: err instanceof Error ? err.message : String(err),
      });
      throw new StudioStorageError('setDraft', err);
    }
  }

  async deleteDraft(userId: string, filePath: string): Promise<void> {
    const db = await this.ensureReady();
    try {
      // Idempotent by SQL semantics: DELETE on a missing row is not an error.
      await db.query(SQL_DELETE_DRAFT, [userId, filePath]);
      this.logger.info('studio_delete_draft', {
        userId: redactUser(userId),
        filePath,
      });
    } catch (err) {
      this.logger.error('studio_delete_draft_failed', {
        userId: redactUser(userId),
        filePath,
        error: err instanceof Error ? err.message : String(err),
      });
      throw new StudioStorageError('deleteDraft', err);
    }
  }

  async listDrafts(userId: string): Promise<DraftFile[]> {
    const db = await this.ensureReady();
    try {
      const result = await db.query<DraftRow>(SQL_LIST_DRAFTS, [userId]);
      return result.rows.map((row) => ({
        filePath: row.file_path,
        content: row.content,
        updatedAt: toIsoString(row.updated_at),
      }));
    } catch (err) {
      this.logger.error('studio_list_drafts_failed', {
        userId: redactUser(userId),
        error: err instanceof Error ? err.message : String(err),
      });
      throw new StudioStorageError('listDrafts', err);
    }
  }

  async discardAll(userId: string): Promise<void> {
    const db = await this.ensureReady();
    try {
      await db.query(SQL_DISCARD_ALL, [userId]);
      this.logger.info('studio_discard_all', {userId: redactUser(userId)});
    } catch (err) {
      this.logger.error('studio_discard_all_failed', {
        userId: redactUser(userId),
        error: err instanceof Error ? err.message : String(err),
      });
      throw new StudioStorageError('discardAll', err);
    }
  }

  /**
   * Write every staged draft to the local repository filesystem and then
   * clear the draft rows.
   *
   * Local dev has no GitHub App and no git pipeline, so there is no real
   * commit SHA to return. We synthesize a deterministic placeholder of the
   * form `local-<16 hex chars>` using `crypto.randomBytes` so that:
   *
   *   1. Callers that store or log the SHA see something unique per publish
   *      (useful for correlating log lines);
   *   2. Callers that pattern-match `^local-` can detect "this was a local
   *      publish, there is no git commit to link to";
   *   3. `commitUrl` stays `undefined` because there is nothing to link to.
   *
   * The DB delete runs inside a PGlite transaction so that a failure to
   * clear drafts after the filesystem writes succeeded still surfaces an
   * error. However, the filesystem writes themselves are NOT transactional
   * (no rollback) — if a later file fails to write, the earlier files stay
   * on disk and the drafts stay in the DB. This mirrors how the cloud
   * backend's GitHub App will behave under partial failure and matches the
   * first-publish-wins contract in `backend.ts`.
   *
   * `commitMessage` is currently unused in local dev (nothing records it) —
   * we log it so it's at least visible to the operator.
   */
  async publish(
    userId: string,
    commitMessage: string,
  ): Promise<PublishResult> {
    const db = await this.ensureReady();
    const drafts = await this.listDrafts(userId);

    if (drafts.length === 0) {
      // Empty publish is allowed: no-op plus placeholder SHA. Matches how the
      // cloud backend will handle a user clicking "Publish" with no staged
      // changes — returning an error there would be user-hostile.
      const sha = makeLocalSha();
      this.logger.info('studio_publish_empty', {
        userId: redactUser(userId),
        commitMessage,
        commitSha: sha,
      });
      return {commitSha: sha, commitUrl: undefined};
    }

    // Write every draft to the filesystem BEFORE clearing the DB rows. If a
    // write fails the drafts stay staged so the user can retry.
    for (const draft of drafts) {
      const absPath = this.resolveDraftPath(draft.filePath);
      try {
        await mkdir(dirname(absPath), {recursive: true});
        await writeFile(absPath, draft.content, 'utf8');
      } catch (err) {
        this.logger.error('studio_publish_write_failed', {
          userId: redactUser(userId),
          filePath: draft.filePath,
          error: err instanceof Error ? err.message : String(err),
        });
        throw new StudioPublishError(
          `Failed to write draft '${draft.filePath}' to local repo`,
          {cause: err, filePath: draft.filePath},
        );
      }
    }

    // All writes succeeded — clear drafts in one transaction so the state
    // transition to "published" is atomic at the DB level.
    try {
      await db.transaction(async (tx) => {
        await tx.query(SQL_DISCARD_ALL, [userId]);
      });
    } catch (err) {
      this.logger.error('studio_publish_clear_failed', {
        userId: redactUser(userId),
        error: err instanceof Error ? err.message : String(err),
      });
      throw new StudioPublishError(
        'Wrote draft files to disk but failed to clear staged drafts from DB',
        {cause: err},
      );
    }

    const sha = makeLocalSha();
    this.logger.info('studio_publish_succeeded', {
      userId: redactUser(userId),
      commitMessage,
      commitSha: sha,
      fileCount: drafts.length,
    });
    return {commitSha: sha, commitUrl: undefined};
  }

  /**
   * Preview is a cloud-only concept. It exists so a publisher can test draft
   * content in an isolated session without affecting production end-users;
   * locally there are no end-users and `amodal dev` already hot-reloads the
   * running agent on every saved file, so there's no meaningful "preview"
   * separate from "publish then keep editing." Clicking Preview in local dev
   * surfaces this via a friendlier message in DraftWorkspaceBar.
   */
  async buildPreview(_userId: string): Promise<PreviewResult> {
    throw new StudioFeatureUnavailableError(
      'buildPreview',
      'Preview is only available when your agent runs in cloud. In local dev, publish your drafts and amodal dev will hot-reload the agent against the updated files.',
    );
  }

  /**
   * Release resources. No-op if the backend was constructed with an injected
   * `pglite` instance (caller owns lifecycle).
   */
  async close(): Promise<void> {
    if (!this.pglite || !this.ownsPglite) return;
    try {
      await this.pglite.close();
    } finally {
      this.pglite = null;
      this.initialized = false;
    }
  }

  /**
   * Resolve a repo-relative draft path to an absolute filesystem path under
   * `repoPath`, guarding against `..`-style escape. Throws
   * `StudioPublishError` if the normalized path would escape the repo root.
   */
  private resolveDraftPath(filePath: string): string {
    if (isAbsolute(filePath)) {
      throw new StudioPublishError(
        `Draft path must be repo-relative, got absolute: ${filePath}`,
        {filePath},
      );
    }
    const joined = normalize(join(this.repoPath, filePath));
    const rootWithSep = this.repoPath.endsWith(sep)
      ? this.repoPath
      : this.repoPath + sep;
    if (joined !== this.repoPath && !joined.startsWith(rootWithSep)) {
      throw new StudioPublishError(
        `Draft path escapes repo root: ${filePath}`,
        {filePath},
      );
    }
    return joined;
  }
}

/**
 * Convenience factory that constructs and initializes a backend in one step.
 */
export async function createPGLiteStudioBackend(
  options: PGLiteStudioBackendOptions,
): Promise<PGLiteStudioBackend> {
  const backend = new PGLiteStudioBackend(options);
  await backend.init();
  return backend;
}

/**
 * Build a placeholder "local" commit SHA. See the doc comment on `publish()`
 * for why this exists and what callers should do with it.
 */
function makeLocalSha(): string {
  return `local-${randomBytes(8).toString('hex')}`;
}

/**
 * Redact a userId before it goes into structured logs. We keep the first two
 * characters for correlation but strip the rest — matches the "never log raw
 * PII" rule in CLAUDE.md.
 */
function redactUser(userId: string): string {
  if (userId.length <= 2) return '***';
  return `${userId.slice(0, 2)}***`;
}

/**
 * Normalize pglite's `updated_at` column (which may come back as a `Date` or
 * a Postgres timestamp string depending on driver config) to an ISO-8601
 * string so the `DraftFile` contract is stable.
 */
function toIsoString(value: Date | string): string {
  if (value instanceof Date) return value.toISOString();
  // Already a string — trust pglite to give us something parseable.
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) {
    return value;
  }
  return d.toISOString();
}
