/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

/**
 * Error codes for package management failures.
 */
export type PackageErrorCode =
  | 'NOT_FOUND'
  | 'PARSE_FAILED'
  | 'VALIDATION_FAILED'
  | 'LOCK_READ_FAILED'
  | 'LOCK_WRITE_FAILED'
  | 'NPM_INSTALL_FAILED'
  | 'NPM_REMOVE_FAILED'
  | 'CONFIG_INVALID'
  | 'SYMLINK_FAILED'
  | 'IMPORT_NOT_INSTALLED'
  | 'INVALID_FRONTMATTER'
  | 'CONFLICTING_FILTER'
  | 'ENV_WRITE_FAILED'
  | 'ENV_READ_FAILED';

/**
 * Error thrown during package management operations.
 */
export class PackageError extends Error {
  readonly code: PackageErrorCode;

  constructor(code: PackageErrorCode, message: string, cause?: unknown) {
    super(message, {cause});
    this.name = 'PackageError';
    this.code = code;
  }
}
