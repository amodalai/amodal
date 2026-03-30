/**
 * @license
 * Copyright 2025 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import {execSync} from 'node:child_process';
import {mkdtempSync} from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

/**
 * Create a gzipped tarball of the repo directory.
 * Excludes node_modules, .git, and other non-essential files.
 *
 * @returns Path to the tarball file (caller must clean up).
 */
export async function createRepoTarball(repoPath: string): Promise<string> {
  const tarballPath = path.join(
    mkdtempSync(path.join(os.tmpdir(), 'amodal-deploy-')),
    'repo.tar.gz',
  );

  execSync(
    `tar -czf "${tarballPath}" --exclude=node_modules --exclude=.git --exclude=amodal_packages --exclude=.amodal -C "${repoPath}" .`,
    {stdio: 'pipe', timeout: 30_000},
  );

  return tarballPath;
}
