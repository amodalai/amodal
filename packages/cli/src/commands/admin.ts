/**
 * @license
 * Copyright 2025 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import {
  fetchAdminAgent,
  getAdminAgentConfig,
  getAdminAgentVersion,
} from '@amodalai/core';
import {findRepoRoot} from '../shared/repo-discovery.js';

/**
 * Update the global admin agent cache from the registry.
 * Called by `amodal update --admin-agent`.
 */
export async function updateAdminAgentCommand(): Promise<number> {
  let repoPath: string | undefined;
  try {
    repoPath = findRepoRoot();
  } catch {
    // Not in a repo — that's fine
  }

  const config = await getAdminAgentConfig(repoPath);

  if (config.pathOverride) {
    process.stderr.write(`[update] Admin agent is overridden in amodal.json (adminAgent: "${config.pathOverride}").\n`);
    process.stderr.write('[update] The global cache is not used. Update your local copy directly.\n');
    return 1;
  }

  process.stderr.write(config.pinnedVersion
    ? `[update] Fetching admin agent v${config.pinnedVersion} from registry...\n`
    : '[update] Fetching latest admin agent from registry...\n');

  try {
    const dir = await fetchAdminAgent({version: config.pinnedVersion});
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
