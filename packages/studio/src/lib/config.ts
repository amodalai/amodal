/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

/**
 * Typed configuration accessors for Studio environment variables.
 * All process.env reads are centralized here — business logic
 * imports these helpers instead of reading process.env directly.
 */

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const AGENT_ID_ENV_KEY = 'AGENT_ID';
const AGENT_NAME_ENV_KEY = 'AGENT_NAME';
const RUNTIME_URL_ENV_KEY = 'RUNTIME_URL';
const ADMIN_AGENT_URL_ENV_KEY = 'ADMIN_AGENT_URL';
const BASE_PATH_ENV_KEY = 'BASE_PATH';

const DEFAULT_AGENT_ID = 'default';
const DEFAULT_AGENT_NAME = 'default';
const DEFAULT_RUNTIME_URL = 'http://localhost:3847';

// ---------------------------------------------------------------------------
// Accessors
// ---------------------------------------------------------------------------

/**
 * Returns the configured agent ID, falling back to 'default'.
 * Set via the AGENT_ID env var (injected by `amodal dev`).
 */
export function getAgentId(): string {
  return process.env[AGENT_ID_ENV_KEY] ?? DEFAULT_AGENT_ID;
}

/** Returns the agent display name. Prefers AGENT_NAME, falls back to AGENT_ID. */
export function getAgentName(): string {
  return process.env[AGENT_NAME_ENV_KEY] ?? process.env[AGENT_ID_ENV_KEY] ?? DEFAULT_AGENT_NAME;
}

/** Returns the runtime URL from RUNTIME_URL env var. */
export function getRuntimeUrl(): string {
  return process.env[RUNTIME_URL_ENV_KEY] ?? DEFAULT_RUNTIME_URL;
}

/** Returns the admin agent URL, or null if not configured. */
export function getAdminAgentUrl(): string | null {
  return process.env[ADMIN_AGENT_URL_ENV_KEY] ?? null;
}

/**
 * Returns the base path prefix for Studio (e.g. '/studio').
 * Empty string when Studio is served at root (default).
 * Never includes a trailing slash.
 */
export function getBasePath(): string {
  const raw = process.env[BASE_PATH_ENV_KEY] ?? '';
  // Normalize: strip trailing slash, ensure leading slash if non-empty
  if (!raw) return '';
  const trimmed = raw.endsWith('/') ? raw.slice(0, -1) : raw;
  return trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
}
