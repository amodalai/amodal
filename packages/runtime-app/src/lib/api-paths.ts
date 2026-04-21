/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

/**
 * Centralised API and route path constants for the runtime-app.
 *
 * Use these instead of inline string literals so that path changes are
 * caught by the compiler and are easy to find with a single search.
 */

export const API_PATHS = {
  SESSIONS_HISTORY: '/sessions/history',
  PAGES: '/api/pages',
  sessionHistory: (id: string) => `/sessions/history/${encodeURIComponent(id)}`,
} as const;

export const FEEDBACK_PATH = '/api/feedback' as const;
