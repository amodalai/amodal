/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

/**
 * A single connection's configuration (e.g., base_url, api_key).
 */
export type ConnectionConfig = Record<string, unknown>;

/**
 * Map of connection names to their configurations.
 * Example: { device_api: { base_url: "https://...", api_key: "sk-..." } }
 */
export type ConnectionsMap = Record<string, ConnectionConfig>;
