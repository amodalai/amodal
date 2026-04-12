/**
 * @license
 * Copyright 2025 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import {
  WorkspaceFetchError,
  WorkspaceSizeLimitError,
} from './errors.js';
import { Sandbox } from './sandbox.js';
import type {
  FetchWorkspaceResult,
  Logger,
  WorkspaceBundleResponse,
  WorkspaceFile,
} from './types.js';

/**
 * Type guard for validating the workspace bundle response shape.
 * This is a system boundary (external API response) — narrowing with 'in' operator.
 */
function isWorkspaceBundleResponse(
  value: unknown,
): value is WorkspaceBundleResponse {
  if (typeof value !== 'object' || value === null) return false;
  if (!('files' in value)) return false;
  return Array.isArray(value.files);
}

const MAX_WORKSPACE_SIZE_BYTES = 100 * 1024 * 1024; // 100MB
const FETCH_TIMEOUT_MS = 30_000;

interface FetchWorkspaceParams {
  readonly agentId?: string;
}

interface FetchWorkspaceContext {
  readonly studioBaseUrl: string;
  readonly sessionId: string;
  readonly logger: Logger;
}

/**
 * Fetches workspace content from the studio API, writes files to a sandbox,
 * and stashes the original manifest for later diffing.
 */
export async function fetchWorkspace(
  params: FetchWorkspaceParams,
  context: FetchWorkspaceContext,
): Promise<{ result: FetchWorkspaceResult; sandbox: Sandbox }> {
  const { studioBaseUrl, sessionId, logger } = context;
  const startTime = Date.now();

  logger.info('fetch_workspace_start', {
    agent_id: params.agentId,
    session_id: sessionId,
  });

  const url = new URL('/api/studio/workspace', studioBaseUrl);
  if (params.agentId) {
    url.searchParams.set('agentId', params.agentId);
  }

  let response: Response;
  try {
    response = await fetch(url.toString(), {
      method: 'GET',
      headers: { 'Accept': 'application/json' },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
  } catch (error: unknown) {
    throw new WorkspaceFetchError(
      `Failed to connect to studio API at ${studioBaseUrl}`,
      undefined,
      error,
    );
  }

  if (!response.ok) {
    throw new WorkspaceFetchError(
      `Studio API returned ${String(response.status)}: ${response.statusText}`,
      response.status,
    );
  }

  let rawBody: unknown;
  try {
    rawBody = await response.json();
  } catch (error: unknown) {
    throw new WorkspaceFetchError(
      'Failed to parse workspace bundle response',
      response.status,
      error,
    );
  }

  if (!isWorkspaceBundleResponse(rawBody)) {
    throw new WorkspaceFetchError(
      'Invalid workspace bundle: missing files array',
      response.status,
    );
  }

  const bundle = rawBody;

  // Check total size before writing anything
  const totalBytes = bundle.files.reduce(
    (sum: number, file: WorkspaceFile) => sum + Buffer.byteLength(file.content, 'utf-8'),
    0,
  );

  if (totalBytes > MAX_WORKSPACE_SIZE_BYTES) {
    throw new WorkspaceSizeLimitError(totalBytes, MAX_WORKSPACE_SIZE_BYTES);
  }

  const sandbox = await Sandbox.create(sessionId);

  try {
    // Write files to sandbox
    for (const file of bundle.files) {
      const resolvedPath = await sandbox.resolvePath(file.path);
      await fs.mkdir(path.dirname(resolvedPath), { recursive: true });
      await fs.writeFile(resolvedPath, file.content, 'utf-8');
    }

    // Stash manifest for later diffing
    sandbox.stashManifest(bundle.files);
  } catch (error: unknown) {
    // Clean up sandbox on failure
    await sandbox.cleanup();
    throw error;
  }

  const duration = Date.now() - startTime;
  logger.info('fetch_workspace_complete', {
    agent_id: params.agentId,
    session_id: sessionId,
    file_count: bundle.files.length,
    total_bytes: totalBytes,
    duration_ms: duration,
  });

  return {
    result: {
      fileCount: bundle.files.length,
      sandboxPath: sandbox.getRoot(),
    },
    sandbox,
  };
}
