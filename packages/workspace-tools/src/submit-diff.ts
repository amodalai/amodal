/**
 * @license
 * Copyright 2025 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import * as crypto from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import { WorkspaceSubmitError } from './errors.js';
import type { Sandbox } from './sandbox.js';
import type {
  Logger,
  SubmitDiffResult,
  WorkspaceChange,
  WorkspaceChangeKind,
} from './types.js';

const SUBMIT_TIMEOUT_MS = 30_000;

interface SubmitDiffParams {
  readonly commitMessage?: string;
}

interface SubmitDiffContext {
  readonly studioBaseUrl: string;
  readonly sessionId: string;
  readonly sandbox: Sandbox;
  readonly logger: Logger;
}

/**
 * Walks a directory recursively and returns all file paths relative to the root.
 */
async function walkDirectory(dir: string, root: string): Promise<string[]> {
  const results: string[] = [];
  const entries = await fs.readdir(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      const subResults = await walkDirectory(fullPath, root);
      results.push(...subResults);
    } else if (entry.isFile()) {
      results.push(path.relative(root, fullPath));
    }
    // Skip symlinks — we don't follow them in diff computation
  }

  return results;
}

/**
 * Computes a SHA-256 hash of the given content.
 */
function hashContent(content: string): string {
  return crypto.createHash('sha256').update(content).digest('hex');
}

/**
 * Reads the current state of the sandbox, compares it to the stashed manifest,
 * computes a changeset, and submits it to the studio API.
 */
export async function submitDiff(
  params: SubmitDiffParams,
  context: SubmitDiffContext,
): Promise<SubmitDiffResult> {
  const { studioBaseUrl, sessionId, sandbox, logger } = context;
  const startTime = Date.now();

  logger.info('submit_diff_start', { session_id: sessionId });

  const manifest = sandbox.getManifest();
  const sandboxRoot = sandbox.getRoot();
  const currentFiles = await walkDirectory(sandboxRoot, sandboxRoot);

  const changes: WorkspaceChange[] = [];
  const currentPathSet = new Set(currentFiles);

  // Check for added and modified files
  for (const relativePath of currentFiles) {
    const fullPath = path.join(sandboxRoot, relativePath);
    const content = await fs.readFile(fullPath, 'utf-8');
    const currentHash = hashContent(content);
    const originalHash = manifest.get(relativePath);

    if (originalHash === undefined) {
      const kind: WorkspaceChangeKind = 'added';
      changes.push({ kind, path: relativePath, content });
    } else if (originalHash !== currentHash) {
      const kind: WorkspaceChangeKind = 'modified';
      changes.push({ kind, path: relativePath, content });
    }
  }

  // Check for deleted files
  for (const [originalPath] of manifest) {
    if (!currentPathSet.has(originalPath)) {
      const kind: WorkspaceChangeKind = 'deleted';
      changes.push({ kind, path: originalPath });
    }
  }

  // Submit to studio API
  const url = new URL('/api/workspace/changes', studioBaseUrl);

  let response: Response;
  try {
    response = await fetch(url.toString(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        changes,
        commitMessage: params.commitMessage,
      }),
      signal: AbortSignal.timeout(SUBMIT_TIMEOUT_MS),
    });
  } catch (error: unknown) {
    throw new WorkspaceSubmitError(
      `Failed to connect to studio API at ${studioBaseUrl}`,
      undefined,
      error,
    );
  }

  if (!response.ok) {
    throw new WorkspaceSubmitError(
      `Studio API returned ${String(response.status)}: ${response.statusText}`,
      response.status,
    );
  }

  const result: SubmitDiffResult = {
    added: changes.filter((c) => c.kind === 'added').length,
    modified: changes.filter((c) => c.kind === 'modified').length,
    deleted: changes.filter((c) => c.kind === 'deleted').length,
  };

  const duration = Date.now() - startTime;
  logger.info('submit_diff_complete', {
    session_id: sessionId,
    added: result.added,
    modified: result.modified,
    deleted: result.deleted,
    duration_ms: duration,
  });

  return result;
}
