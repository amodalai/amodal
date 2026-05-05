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
export const GETTING_STARTED_PATH = 'getting-started';

export function sessionPath(sessionId: string): string {
  return `${SESSIONS_PATH}/${encodeURIComponent(sessionId)}`;
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
