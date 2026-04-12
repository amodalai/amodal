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

  return backend;
}

/**
 * Reset the backend singleton. Used for testing only.
 */
export function resetBackend(): void {
  backendPromise = null;
}
