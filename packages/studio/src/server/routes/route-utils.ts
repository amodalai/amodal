/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import { getBasePath } from '../../lib/api.js';

/**
 * Extract the wildcard portion of a request path after a known prefix.
 *
 * Hono's `c.req.param('*')` can return `undefined` for wildcard routes,
 * so we use a deterministic string-based extraction instead.
 *
 * Handles BASE_PATH: if the path starts with the base path prefix, it is
 * stripped before matching the route prefix.
 *
 * @example
 *   extractWildcard('/api/drafts/skills/greet.md', '/api/drafts/')          // => 'skills/greet.md'
 *   extractWildcard('/studio/api/drafts/skills/greet.md', '/api/drafts/')   // => 'skills/greet.md' (with BASE_PATH=/studio)
 *   extractWildcard('/api/drafts/', '/api/drafts/')                         // => ''
 */
export function extractWildcard(path: string, prefix: string): string {
  // Strip the base path prefix if present so route-level prefixes match.
  const basePath = getBasePath();
  const normalized = basePath && path.startsWith(basePath) ? path.slice(basePath.length) : path;

  const raw = normalized.startsWith(prefix) ? normalized.slice(prefix.length) : '';
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}
