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
// Page routes
// ---------------------------------------------------------------------------

export const STORES_PATH = '/stores';
export const COST_PATH = 'cost';
export const SESSIONS_PATH = 'sessions';
export const CONNECTIONS_PATH = 'connections';

export function sessionPath(sessionId: string): string {
  return `${SESSIONS_PATH}/${encodeURIComponent(sessionId)}`;
}

export function connectionConfigPath(packageName: string): string {
  return `${CONNECTIONS_PATH}/${encodeURIComponent(packageName)}`;
}

export function connectionInspectPath(connectionName: string): string {
  return `inspect/connections/${encodeURIComponent(connectionName)}`;
}

export function storePath(storeName: string): string {
  return `${STORES_PATH}/${encodeURIComponent(storeName)}`;
}

export function documentPath(storeName: string, key: string): string {
  return `${STORES_PATH}/${encodeURIComponent(storeName)}/${encodeURIComponent(key)}`;
}

// ---------------------------------------------------------------------------
// API routes
// ---------------------------------------------------------------------------

export const API_STORES_BASE = '/api/stores';

export function apiStoreDocumentsPath(storeName: string): string {
  return studioApiUrl(`${API_STORES_BASE}/${encodeURIComponent(storeName)}/documents`);
}

export function apiDocumentPath(storeName: string, key: string): string {
  return studioApiUrl(`${API_STORES_BASE}/${encodeURIComponent(storeName)}/documents/${encodeURIComponent(key)}`);
}
