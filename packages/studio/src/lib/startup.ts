/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import type { StudioBackend } from './backend';
import { PGLiteStudioBackend } from './pglite-backend';
import { logger } from './logger';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const REPO_PATH_ENV_KEY = 'REPO_PATH';
const PGLITE_DATA_DIR_ENV_KEY = 'PGLITE_DATA_DIR';
const DEFAULT_PGLITE_DATA_DIR = '.studio-data';

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

let backendPromise: Promise<StudioBackend> | null = null;

/**
 * Get the singleton StudioBackend instance.
 * Initializes on first call (creates PGLite tables, etc.).
 *
 * Reads configuration from environment variables:
 * - REPO_PATH: path to the agent's repo directory (required)
 * - PGLITE_DATA_DIR: path for PGLite data storage (defaults to .studio-data)
 * - DATABASE_URL: when set, the Studio also initializes a shared Postgres
 *   connection (via @amodalai/db) for reading operational data (stores,
 *   sessions, feedback). Draft storage still uses PGLite.
 */
export function getBackend(): Promise<StudioBackend> {
  if (backendPromise) return backendPromise;

  backendPromise = initializeBackend();
  return backendPromise;
}

async function initializeBackend(): Promise<StudioBackend> {
  const repoPath = process.env[REPO_PATH_ENV_KEY];
  if (!repoPath) {
    throw new Error(
      `${REPO_PATH_ENV_KEY} environment variable is required. Set it to the path of the agent repo being edited.`,
    );
  }

  const dataDir = process.env[PGLITE_DATA_DIR_ENV_KEY] ?? DEFAULT_PGLITE_DATA_DIR;

  logger.info('backend_startup', { repoPath, dataDir });

  const backend = new PGLiteStudioBackend({ repoPath, dataDir });
  await backend.initialize();

  // If DATABASE_URL is set, eagerly initialize the shared Postgres
  // connection so that query modules can use it. This is separate from
  // the PGLite backend which handles draft storage.
  if (process.env['DATABASE_URL']) {
    try {
      const { getStudioDb } = await import('./db');
      await getStudioDb();
      logger.info('postgres_connection_ready');
    } catch (err: unknown) {
      // Log but don't block startup — Postgres data features are optional
      // when developing locally without a database.
      logger.warn('postgres_connection_failed', {
        reason: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return backend;
}

/**
 * Reset the backend singleton. Used for testing only.
 */
export function resetBackend(): void {
  backendPromise = null;
}
