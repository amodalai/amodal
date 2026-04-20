/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

/**
 * Extract the wildcard portion of a request path after a known prefix.
 *
 * Hono's `c.req.param('*')` can return `undefined` for wildcard routes,
 * so we use a deterministic string-based extraction instead.
 *
 * @example
 *   extractWildcard('/api/drafts/skills/greet.md', '/api/drafts/') // => 'skills/greet.md'
 *   extractWildcard('/api/drafts/', '/api/drafts/')                // => ''
 */
export function extractWildcard(path: string, prefix: string): string {
  const raw = path.startsWith(prefix) ? path.slice(prefix.length) : '';
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}
