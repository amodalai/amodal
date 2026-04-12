/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

const CONTENT_DIRS = [
  'skills',
  'knowledge',
  'connections',
  'automations',
  'stores',
  'agents',
] as const;

const CONTENT_EXTENSIONS = ['.md', '.json', '.yaml', '.yml'] as const;

/**
 * Returns true if every path in `changedPaths` is a content file under a
 * convention directory.
 *
 * Empty input returns true vacuously (matching `Array.every` semantics).
 * Callers that need to distinguish "no changes" from "all content" should
 * check the input length separately before invoking the fast path.
 */
export function isContentOnlyChange(changedPaths: readonly string[]): boolean {
  return changedPaths.every(isContentPath);
}

function isContentPath(filePath: string): boolean {
  const normalized = filePath.replace(/^\/+/, '');
  const firstSegment = normalized.split('/')[0];
  if (firstSegment === undefined) return false;
  if (!(CONTENT_DIRS as readonly string[]).includes(firstSegment)) return false;
  const lower = normalized.toLowerCase();
  return (CONTENT_EXTENSIONS as readonly string[]).some((ext) =>
    lower.endsWith(ext)
  );
}
