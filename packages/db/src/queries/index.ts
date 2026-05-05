/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

/**
 * Per-domain query modules — the Midday pattern. Each file holds a
 * focused set of typed Drizzle queries that take `db` as the first
 * arg and return typed results. No storage facade for new code.
 */

export * from './setup-state.js';
export * from './sessions.js';
