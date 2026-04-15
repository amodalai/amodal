/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { createHash } from 'node:crypto';
import { eq, and, getDb, ensureSchema, studioDrafts } from '@amodalai/db';
import type { NodePgDatabase } from '@amodalai/db';
import type { StudioBackend } from './backend';
import type { DraftFile, PublishResult, WorkspaceBundle, WorkspaceFile } from './types';
import { StudioStorageError, StudioPublishError } from './errors';
import { logger } from './logger';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

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
// Drizzle backend implementation
// ---------------------------------------------------------------------------

export interface DrizzleStudioBackendOptions {
  repoPath: string;
  /** Override DATABASE_URL env var. Used in cloud to scope to per-agent databases. */
  databaseUrl?: string;
}

export class DrizzleStudioBackend implements StudioBackend {
  private db: NodePgDatabase;
  private repoPath: string;
  private log = logger.child({ backend: 'drizzle' });

  constructor(options: DrizzleStudioBackendOptions) {
    this.repoPath = options.repoPath;
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- getDb returns Db which extends NodePgDatabase
    this.db = getDb(options.databaseUrl) as unknown as NodePgDatabase;
  }

  async initialize(): Promise<void> {
    const start = Date.now();
    try {
      await ensureSchema(this.db);
      this.log.info('backend_initialized', { durationMs: Date.now() - start });
    } catch (err: unknown) {
      throw new StudioStorageError('Failed to initialize database', {
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
      const rows = await this.db
        .select({
          filePath: studioDrafts.filePath,
          content: studioDrafts.content,
          updatedAt: studioDrafts.updatedAt,
        })
        .from(studioDrafts)
        .where(eq(studioDrafts.userId, userId))
        .orderBy(studioDrafts.filePath);

      this.log.debug('list_drafts', { userId, count: rows.length, durationMs: Date.now() - start });
      return rows.map(row => ({
        filePath: row.filePath,
        content: row.content,
        updatedAt: row.updatedAt.toISOString(),
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
      const rows = await this.db
        .select({
          filePath: studioDrafts.filePath,
          content: studioDrafts.content,
          updatedAt: studioDrafts.updatedAt,
        })
        .from(studioDrafts)
        .where(and(eq(studioDrafts.userId, userId), eq(studioDrafts.filePath, filePath)))
        .limit(1);

      this.log.debug('read_draft', { userId, filePath, found: rows.length > 0, durationMs: Date.now() - start });
      if (rows.length === 0) return null;
      const row = rows[0];
      return {
        filePath: row.filePath,
        content: row.content,
        updatedAt: row.updatedAt.toISOString(),
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
      await this.db
        .insert(studioDrafts)
        .values({ userId, filePath, content, updatedAt: new Date() })
        .onConflictDoUpdate({
          target: [studioDrafts.userId, studioDrafts.filePath],
          set: { content, updatedAt: new Date() },
        });
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
      await this.db
        .delete(studioDrafts)
        .where(and(eq(studioDrafts.userId, userId), eq(studioDrafts.filePath, filePath)));
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
      const deleted = await this.db
        .delete(studioDrafts)
        .where(eq(studioDrafts.userId, userId))
        .returning({ filePath: studioDrafts.filePath });
      const count = deleted.length;
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
        logger.warn('workspace_amodal_json_parse_error', { repoPath: this.repoPath });
      }
    }

    this.log.info('get_workspace', { agentId, fileCount: files.length, durationMs: Date.now() - start });
    return { agentId, files };
  }
}
