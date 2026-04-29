/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

/**
 * Browser-side API URL utilities.
 *
 * Reads the Studio base path from `window.__STUDIO_BASE_PATH__` (injected
 * by the server into the HTML) so that all Studio API calls work correctly
 * when Studio is mounted at a subpath like `/studio`.
 *
 * Runtime API calls (to the separate runtime server) are unaffected — they
 * use the full `runtimeUrl` from StudioConfigContext.
 */

// ---------------------------------------------------------------------------
// Base path accessor
// ---------------------------------------------------------------------------

/**
 * Returns the Studio base path, e.g. `'/studio'` or `''` (empty string
 * when served at root). Never includes a trailing slash.
 *
 * In the browser, reads from `window.__STUDIO_BASE_PATH__` injected by the
 * server. On the server side (no `window`), always returns empty string.
 */
export function getBasePath(): string {
  // Guard for server-side (no DOM global). The `globalThis` check avoids
  // referencing `window` directly, which would fail the Node-only tsc build.
  const win = typeof globalThis !== 'undefined'
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- runtime global check at system boundary
    ? (globalThis as Record<string, unknown>)['window'] as Record<string, unknown> | undefined
    : undefined;
  if (win && typeof win['__STUDIO_BASE_PATH__'] === 'string') {
    return win['__STUDIO_BASE_PATH__'];
  }
  return '';
}

// ---------------------------------------------------------------------------
// URL builder
// ---------------------------------------------------------------------------

/**
 * Prefix a Studio API path with the base path.
 *
 * @example
 * ```ts
 * // BASE_PATH = '/studio'
 * studioApiUrl('/api/config')  // => '/studio/api/config'
 *
 * // BASE_PATH = '' (default)
 * studioApiUrl('/api/config')  // => '/api/config'
 * ```
 */
export function studioApiUrl(path: string): string {
  return `${getBasePath()}${path}`;
}
