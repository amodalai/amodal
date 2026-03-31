/**
 * @license
 * Copyright 2025 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import {readFile} from 'node:fs/promises';
import * as path from 'node:path';
import {
  fetchAdminAgent,
  getAdminAgentVersion,
} from '@amodalai/core';
import {findRepoRoot} from '../shared/repo-discovery.js';

/**
 * Update the global admin agent cache from the registry.
 * Called by `amodal update --admin-agent`.
 */
export async function updateAdminAgentCommand(): Promise<number> {
  // Check if amodal.json overrides the admin agent
  let repoPath: string | undefined;
  try {
    repoPath = findRepoRoot();
  } catch {
    // Not in a repo — that's fine
  }

  if (repoPath) {
    try {
      const configRaw = await readFile(path.join(repoPath, 'amodal.json'), 'utf-8');
      const parsed: unknown = JSON.parse(configRaw);
      if (parsed && typeof parsed === 'object' && 'adminAgent' in parsed) {
         
        const adminPath = (parsed as Record<string, unknown>)['adminAgent'];
        if (typeof adminPath === 'string') {
          process.stderr.write(`[update] Admin agent is overridden in amodal.json (adminAgent: "${adminPath}").\n`);
          process.stderr.write('[update] The global cache is not used. Update your local copy directly.\n');
          return 1;
        }
      }
    } catch {
      // No config or parse error — proceed
    }
  }

  process.stderr.write('[update] Fetching latest admin agent from registry...\n');
  try {
    const dir = await fetchAdminAgent();
    const version = await getAdminAgentVersion(dir);
    process.stderr.write(`[update] Admin agent updated to v${version ?? 'unknown'}\n`);
    process.stderr.write(`[update] Cached at ${dir}\n`);
    return 0;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`[update] Admin agent update failed: ${msg}\n`);
    return 1;
  }
}
