/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import type { StudioBackend } from './backend';
import { DrizzleStudioBackend } from './drizzle-backend';
import { logger } from './logger';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const REPO_PATH_ENV_KEY = 'REPO_PATH';

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

let backendPromise: Promise<StudioBackend> | null = null;

/**
 * Get the singleton StudioBackend instance.
 * Initializes on first call (runs ensureSchema, etc.).
 *
 * Reads configuration from environment variables:
 * - REPO_PATH: path to the agent's repo directory (required)
 * - DATABASE_URL: Postgres connection string (required, read by @amodalai/db)
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

  logger.info('backend_startup', { repoPath });

  const backend = new DrizzleStudioBackend({ repoPath });
  await backend.initialize();

  return backend;
}

/**
 * Reset the backend singleton. Used for testing only.
 */
export function resetBackend(): void {
  backendPromise = null;
}
