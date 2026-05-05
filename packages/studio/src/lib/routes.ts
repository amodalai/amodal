/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

/**
 * Route path constants for Studio pages and API endpoints.
 * Avoids magic strings scattered across components.
 */

import { studioApiUrl } from './api';

// ---------------------------------------------------------------------------
// Root routes
// ---------------------------------------------------------------------------

export const ROOT_PATH = '/';
export const NOT_FOUND_PATH = '*';
export const AGENTS_BASE_PATH = '/agents';
export const DEFAULT_AGENT_ID = 'local';

// ---------------------------------------------------------------------------
// Agent page route segments
// ---------------------------------------------------------------------------

export const OVERVIEW_PATH = '';
export const SETUP_PATH = 'setup';
export const UPDATES_PATH = 'updates';
export const CONNECTIONS_PATH = 'connections';
export const SESSIONS_PATH = 'sessions';
export const COST_PATH = 'cost';
export const AGENT_PATH = 'agent';
export const FILES_PATH = 'files';
export const STORES_PATH = 'stores';
export const AUTOMATIONS_PATH = 'automations';
export const EVALS_PATH = 'evals';
export const FEEDBACK_PATH = 'feedback';
export const MEMORY_PATH = 'memory';
export const ARENA_PATH = 'arena';
export const PROMPT_PATH = 'prompt';
export const SECRETS_PATH = 'secrets';
export const MODELS_PATH = 'models';
export const SYSTEM_PATH = 'system';
export const INSPECT_PATH = 'inspect';

export function defaultAgentPath(): string {
  return `${AGENTS_BASE_PATH}/${DEFAULT_AGENT_ID}`;
}

export function agentRoutePattern(): string {
  return `${AGENTS_BASE_PATH}/:agentId/*`;
}

export function sessionPath(sessionId: string): string {
  return `${SESSIONS_PATH}/${encodeURIComponent(sessionId)}`;
}

export function connectionConfigPath(packageName: string): string {
  return `${CONNECTIONS_PATH}/${encodeURIComponent(packageName)}`;
}

export function connectionInspectPath(connectionName: string): string {
  return `${INSPECT_PATH}/connections/${encodeURIComponent(connectionName)}`;
}

export function storePathSegment(storeName: string): string {
  return encodeURIComponent(storeName);
}

export function documentPathSegment(key: string): string {
  return encodeURIComponent(key);
}

// ---------------------------------------------------------------------------
// API routes
// ---------------------------------------------------------------------------

export const API_STORES_BASE = '/api/stores';
export const RUNTIME_CONNECTION_PACKAGES_PATH = '/api/connection-packages';

export function apiStoreDocumentsPath(storeName: string): string {
  return studioApiUrl(`${API_STORES_BASE}/${encodeURIComponent(storeName)}/documents`);
}

export function apiDocumentPath(storeName: string, key: string): string {
  return studioApiUrl(`${API_STORES_BASE}/${encodeURIComponent(storeName)}/documents/${encodeURIComponent(key)}`);
}
