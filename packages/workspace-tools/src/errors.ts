/**
 * @license
 * Copyright 2025 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

/**
 * Thrown when a path operation attempts to escape the sandbox directory.
 */
export class SandboxEscapeError extends Error {
  readonly requestedPath: string;
  readonly sandboxRoot: string;

  constructor(requestedPath: string, sandboxRoot: string) {
    super(
      `Path escapes sandbox: requested "${requestedPath}" resolved outside "${sandboxRoot}"`,
    );
    this.name = 'SandboxEscapeError';
    this.requestedPath = requestedPath;
    this.sandboxRoot = sandboxRoot;
  }
}

/**
 * Base error for workspace operations.
 */
export class WorkspaceError extends Error {
  readonly operation: string;

  constructor(operation: string, message: string, cause?: unknown) {
    super(message, { cause });
    this.name = 'WorkspaceError';
    this.operation = operation;
  }
}

/**
 * Thrown when fetching workspace content from the studio API fails.
 */
export class WorkspaceFetchError extends WorkspaceError {
  readonly statusCode: number | undefined;

  constructor(message: string, statusCode?: number, cause?: unknown) {
    super('fetch_workspace', message, cause);
    this.name = 'WorkspaceFetchError';
    this.statusCode = statusCode;
  }
}

/**
 * Thrown when submitting a diff to the studio API fails.
 */
export class WorkspaceSubmitError extends WorkspaceError {
  readonly statusCode: number | undefined;

  constructor(message: string, statusCode?: number, cause?: unknown) {
    super('submit_diff', message, cause);
    this.name = 'WorkspaceSubmitError';
    this.statusCode = statusCode;
  }
}

/**
 * Thrown when the fetched workspace exceeds the size limit.
 */
export class WorkspaceSizeLimitError extends WorkspaceError {
  readonly totalBytes: number;
  readonly limitBytes: number;

  constructor(totalBytes: number, limitBytes: number) {
    super(
      'fetch_workspace',
      `Workspace size ${totalBytes} bytes exceeds limit of ${limitBytes} bytes`,
    );
    this.name = 'WorkspaceSizeLimitError';
    this.totalBytes = totalBytes;
    this.limitBytes = limitBytes;
  }
}
