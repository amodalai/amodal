/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import { PGlite } from '@electric-sql/pglite';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { createHash } from 'node:crypto';
import type { StudioBackend } from './backend';
import type { DraftFile, PublishResult, WorkspaceBundle, WorkspaceFile } from './types';
import { StudioStorageError, StudioPublishError } from './errors';
import { logger } from './logger';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const INIT_SQL = `
CREATE TABLE IF NOT EXISTS studio_drafts (
  user_id    TEXT        NOT NULL,
  file_path  TEXT        NOT NULL,
  content    TEXT        NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, file_path)
);
`;

/**
 * Directories to walk when building the workspace bundle.
 * These match the allowed directories in draft-path.ts.
 */
const WORKSPACE_DIRECTORIES = [
  'skills',
  'knowledge',
  'connections',
  'automations',
  'stores',
  'agents',
  'tools',
  'pages',
  'public',
] as const;

/** Root-level files to include in the workspace bundle. */
const WORKSPACE_ROOT_FILES = [
  'amodal.json',
] as const;

// ---------------------------------------------------------------------------
// Helper: error type guard
// ---------------------------------------------------------------------------

function isEnoentError(err: unknown): boolean {
  return (
    err != null &&
    typeof err === 'object' &&
    'code' in err &&
    err.code === 'ENOENT'
  );
}

// ---------------------------------------------------------------------------
// Helper: recursive file walker
// ---------------------------------------------------------------------------

async function walkDirectory(dirPath: string, basePath: string): Promise<WorkspaceFile[]> {
  const files: WorkspaceFile[] = [];

  let entries: string[];
  try {
    entries = await fs.readdir(dirPath);
  } catch (err: unknown) {
    // Directory doesn't exist — that's fine, not every agent has every directory
    if (isEnoentError(err)) {
      return files;
    }
    throw err;
  }

  for (const entryName of entries) {
    const fullPath = path.join(dirPath, entryName);
    const relativePath = path.relative(basePath, fullPath);

    const stat = await fs.stat(fullPath);
    if (stat.isDirectory()) {
      const subFiles = await walkDirectory(fullPath, basePath);
      files.push(...subFiles);
    } else if (stat.isFile()) {
      try {
        const content = await fs.readFile(fullPath, 'utf-8');
        files.push({ path: relativePath, content });
      } catch (readErr: unknown) {
        // Skip files we can't read (binary, permissions, etc.)
        logger.warn('workspace_file_skip', {
          filePath: relativePath,
          reason: readErr instanceof Error ? readErr.message : String(readErr),
        });
      }
    }
  }

  return files;
}

// ---------------------------------------------------------------------------
// PGLite backend implementation
// ---------------------------------------------------------------------------

interface DraftRow {
  file_path: string;
  content: string;
  updated_at: string;
}

export class PGLiteStudioBackend implements StudioBackend {
  private db: PGlite;
  private repoPath: string;
  private log = logger.child({ backend: 'pglite' });

  constructor(options: { repoPath: string; dataDir?: string }) {
    this.repoPath = options.repoPath;
    // Use a data directory for persistence, or in-memory if not specified
    this.db = new PGlite(options.dataDir);
  }

  async initialize(): Promise<void> {
    const start = Date.now();
    try {
      await this.db.exec(INIT_SQL);
      this.log.info('backend_initialized', { durationMs: Date.now() - start });
    } catch (err: unknown) {
      throw new StudioStorageError('Failed to initialize PGLite database', {
        operation: 'initialize',
        cause: err,
      });
    }
  }

  // -------------------------------------------------------------------------
  // Draft CRUD
  // -------------------------------------------------------------------------

  async listDrafts(userId: string): Promise<DraftFile[]> {
    const start = Date.now();
    try {
      const result = await this.db.query<DraftRow>(
        'SELECT file_path, content, updated_at FROM studio_drafts WHERE user_id = $1 ORDER BY file_path',
        [userId],
      );
      this.log.debug('list_drafts', { userId, count: result.rows.length, durationMs: Date.now() - start });
      return result.rows.map(row => ({
        filePath: row.file_path,
        content: row.content,
        updatedAt: typeof row.updated_at === 'string' ? row.updated_at : new Date(row.updated_at).toISOString(),
      }));
    } catch (err: unknown) {
      throw new StudioStorageError('Failed to list drafts', {
        operation: 'listDrafts',
        cause: err,
        context: { userId },
      });
    }
  }

  async readDraft(userId: string, filePath: string): Promise<DraftFile | null> {
    const start = Date.now();
    try {
      const result = await this.db.query<DraftRow>(
        'SELECT file_path, content, updated_at FROM studio_drafts WHERE user_id = $1 AND file_path = $2',
        [userId, filePath],
      );
      this.log.debug('read_draft', { userId, filePath, found: result.rows.length > 0, durationMs: Date.now() - start });
      if (result.rows.length === 0) return null;
      const row = result.rows[0];
      return {
        filePath: row.file_path,
        content: row.content,
        updatedAt: typeof row.updated_at === 'string' ? row.updated_at : new Date(row.updated_at).toISOString(),
      };
    } catch (err: unknown) {
      throw new StudioStorageError('Failed to read draft', {
        operation: 'readDraft',
        cause: err,
        context: { userId, filePath },
      });
    }
  }

  async saveDraft(userId: string, filePath: string, content: string): Promise<void> {
    const start = Date.now();
    try {
      await this.db.query(
        `INSERT INTO studio_drafts (user_id, file_path, content, updated_at)
         VALUES ($1, $2, $3, now())
         ON CONFLICT (user_id, file_path) DO UPDATE SET content = $3, updated_at = now()`,
        [userId, filePath, content],
      );
      this.log.debug('save_draft', { userId, filePath, durationMs: Date.now() - start });
    } catch (err: unknown) {
      throw new StudioStorageError('Failed to save draft', {
        operation: 'saveDraft',
        cause: err,
        context: { userId, filePath },
      });
    }
  }

  async deleteDraft(userId: string, filePath: string): Promise<void> {
    const start = Date.now();
    try {
      await this.db.query(
        'DELETE FROM studio_drafts WHERE user_id = $1 AND file_path = $2',
        [userId, filePath],
      );
      this.log.debug('delete_draft', { userId, filePath, durationMs: Date.now() - start });
    } catch (err: unknown) {
      throw new StudioStorageError('Failed to delete draft', {
        operation: 'deleteDraft',
        cause: err,
        context: { userId, filePath },
      });
    }
  }

  async discardAllDrafts(userId: string): Promise<number> {
    const start = Date.now();
    try {
      const result = await this.db.query<{ count: string }>(
        'WITH deleted AS (DELETE FROM studio_drafts WHERE user_id = $1 RETURNING *) SELECT count(*)::text AS count FROM deleted',
        [userId],
      );
      const count = parseInt(result.rows[0].count, 10);
      this.log.info('discard_all_drafts', { userId, count, durationMs: Date.now() - start });
      return count;
    } catch (err: unknown) {
      throw new StudioStorageError('Failed to discard all drafts', {
        operation: 'discardAllDrafts',
        cause: err,
        context: { userId },
      });
    }
  }

  // -------------------------------------------------------------------------
  // Publish
  // -------------------------------------------------------------------------

  async publishDrafts(userId: string): Promise<PublishResult> {
    const start = Date.now();
    const drafts = await this.listDrafts(userId);

    if (drafts.length === 0) {
      return { commitRef: 'local-noop', filesPublished: 0 };
    }

    // Write each draft to disk
    for (const draft of drafts) {
      const targetPath = path.join(this.repoPath, draft.filePath);

      try {
        await fs.mkdir(path.dirname(targetPath), { recursive: true });
        await fs.writeFile(targetPath, draft.content, 'utf-8');
      } catch (err: unknown) {
        throw new StudioPublishError(
          `Failed to write draft file '${draft.filePath}' to disk`,
          {
            cause: err,
            context: { filePath: draft.filePath, targetPath },
          },
        );
      }
    }

    // Clear all drafts after successful write
    await this.discardAllDrafts(userId);

    // Generate a commit ref from the content hash
    const contentHash = createHash('sha256')
      .update(drafts.map(d => `${d.filePath}:${d.content}`).join('\n'))
      .digest('hex')
      .slice(0, 12);
    const commitRef = `local-${contentHash}`;

    this.log.info('publish_drafts', {
      userId,
      filesPublished: drafts.length,
      commitRef,
      durationMs: Date.now() - start,
    });

    return { commitRef, filesPublished: drafts.length };
  }

  // -------------------------------------------------------------------------
  // Workspace
  // -------------------------------------------------------------------------

  async getWorkspace(): Promise<WorkspaceBundle> {
    const start = Date.now();
    const files: WorkspaceFile[] = [];

    // Walk each allowed directory
    for (const dir of WORKSPACE_DIRECTORIES) {
      const dirPath = path.join(this.repoPath, dir);
      const dirFiles = await walkDirectory(dirPath, this.repoPath);
      files.push(...dirFiles);
    }

    // Read root-level files
    for (const rootFile of WORKSPACE_ROOT_FILES) {
      const filePath = path.join(this.repoPath, rootFile);
      try {
        const content = await fs.readFile(filePath, 'utf-8');
        files.push({ path: rootFile, content });
      } catch (err: unknown) {
        // Root file doesn't exist — that's fine
        if (!isEnoentError(err)) {
          logger.warn('workspace_root_file_error', {
            filePath: rootFile,
            reason: err instanceof Error ? err.message : String(err),
          });
        }
      }
    }

    // Derive agentId from amodal.json or directory name
    let agentId = path.basename(this.repoPath);
    const amodalJsonFile = files.find(f => f.path === 'amodal.json');
    if (amodalJsonFile) {
      try {
        const parsed: unknown = JSON.parse(amodalJsonFile.content);
        if (typeof parsed === 'object' && parsed !== null && 'name' in parsed) {
          const name = (parsed as Record<string, unknown>)['name'];
          if (typeof name === 'string' && name.length > 0) {
            agentId = name;
          }
        }
      } catch {
        // Invalid JSON in amodal.json — use directory name
        logger.warn('workspace_amodal_json_parse_error', { repoPath: this.repoPath });
      }
    }

    this.log.info('get_workspace', { agentId, fileCount: files.length, durationMs: Date.now() - start });
    return { agentId, files };
  }
}
