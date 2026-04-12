/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import { StudioPathError } from './errors';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Allowed top-level directories for draft files.
 * Only files under these directories (or exact matches for root files) are valid.
 */
const ALLOWED_DIRECTORIES = [
  'skills/',
  'knowledge/',
  'connections/',
  'automations/',
  'stores/',
  'agents/',
  'tools/',
  'pages/',
  'public/',
] as const;

/**
 * Allowed root-level files (exact matches).
 */
const ALLOWED_ROOT_FILES = [
  'amodal.json',
] as const;

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/**
 * Validates and sanitizes a draft file path.
 *
 * Rejects:
 * - Absolute paths (starting with /)
 * - Path traversal segments (..)
 * - Null bytes
 * - Paths outside allowed directories
 * - Empty paths
 *
 * Returns the validated path (trimmed of leading/trailing whitespace).
 *
 * @throws StudioPathError if the path is invalid
 */
export function validateDraftPath(rawPath: string): string {
  const filePath = rawPath.trim();

  if (filePath.length === 0) {
    throw new StudioPathError('File path must not be empty', { filePath: rawPath });
  }

  if (filePath.includes('\0')) {
    throw new StudioPathError('File path must not contain null bytes', { filePath });
  }

  if (filePath.startsWith('/')) {
    throw new StudioPathError('File path must be relative, not absolute', { filePath });
  }

  if (filePath.includes('..')) {
    throw new StudioPathError('File path must not contain path traversal segments', { filePath });
  }

  // Check against allowed directories
  const isAllowedDirectory = ALLOWED_DIRECTORIES.some(dir => filePath.startsWith(dir));
  const isAllowedRootFile = ALLOWED_ROOT_FILES.some(f => filePath === f);

  if (!isAllowedDirectory && !isAllowedRootFile) {
    throw new StudioPathError(
      `File path must be under one of: ${ALLOWED_DIRECTORIES.join(', ')} or be one of: ${ALLOWED_ROOT_FILES.join(', ')}`,
      { filePath },
    );
  }

  return filePath;
}
