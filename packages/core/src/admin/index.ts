/**
 * @license
 * Copyright 2025 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

export {
  resolveAdminAgent,
  fetchAdminAgent,
  updateAdminAgent,
  ensureAdminAgent,
  getAdminAgentVersion,
  getAdminCacheDir,
  getAdminAgentConfig,
  checkRegistryVersion,
} from './admin-agent.js';
export type {AdminAgentConfig, FetchOptions} from './admin-agent.js';

export {loadAdminAgent} from './admin-loader.js';
export type {AdminAgentContent} from './admin-loader.js';
