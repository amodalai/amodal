/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import type { NextRequest } from 'next/server';
import type { StudioBackend } from './backend';
import { DrizzleStudioBackend } from './drizzle-backend';
import { logger } from './logger';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const REPO_PATH_ENV_KEY = 'REPO_PATH';

// ---------------------------------------------------------------------------
// Backend factory override
// ---------------------------------------------------------------------------

/**
 * A function that creates a StudioBackend for a given request.
 * Allows external deployments to inject per-request backends
 * (e.g. scoped to a specific agent or user context).
 */
export type BackendFactory = (req: NextRequest) => Promise<StudioBackend>;

let backendFactory: BackendFactory | null = null;

/**
 * Set a custom backend factory. When set, {@link getBackend} uses this
 * factory instead of the default singleton DrizzleStudioBackend.
 *
 * Call once at application startup (e.g. in a Next.js instrumentation hook).
 * Pass `null` to revert to the default singleton behavior.
 */
export function setBackendFactory(factory: BackendFactory | null): void {
  backendFactory = factory;
}

// ---------------------------------------------------------------------------
// Singleton (default local-dev backend)
// ---------------------------------------------------------------------------

let backendPromise: Promise<StudioBackend> | null = null;

/**
 * Get the StudioBackend instance for a request.
 *
 * If a custom {@link BackendFactory} has been set via {@link setBackendFactory},
 * it is called with the request to produce a per-request backend.
 *
 * Otherwise falls back to the singleton DrizzleStudioBackend, initialized
 * from environment variables:
 * - REPO_PATH: path to the agent's repo directory (required)
 * - DATABASE_URL: Postgres connection string (required, read by @amodalai/db)
 */
export function getBackend(req?: NextRequest): Promise<StudioBackend> {
  if (backendFactory) {
    if (!req) {
      throw new Error(
        'BackendFactory is set but no request was provided to getBackend(). ' +
          'Pass the NextRequest so the factory can resolve the correct backend.',
      );
    }
    return backendFactory(req);
  }

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
