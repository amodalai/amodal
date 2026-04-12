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
const DEFAULT_AGENT_ID = 'default';

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
