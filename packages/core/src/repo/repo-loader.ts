/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import type {AgentBundle, RepoLoadOptions} from './repo-types.js';
import {RepoError} from './repo-types.js';
import {loadRepoFromDisk} from './local-reader.js';
import {loadRepoFromPlatform} from './platform-reader.js';

/**
 * Load an amodal repo from either local disk or the platform API.
 *
 * - If `localPath` is set, reads from disk.
 * - Else if `platformUrl` + `platformApiKey` are set, fetches from the platform.
 * - Otherwise throws CONFIG_NOT_FOUND.
 */
export async function loadRepo(options: RepoLoadOptions): Promise<AgentBundle> {
  if (options.localPath) {
    return loadRepoFromDisk(options.localPath);
  }

  if (options.platformUrl && options.platformApiKey) {
    return loadRepoFromPlatform(options.platformUrl, options.platformApiKey);
  }

  throw new RepoError(
    'CONFIG_NOT_FOUND',
    'No repo source configured. Provide either localPath or platformUrl + platformApiKey.',
  );
}
