/**
 * @license
 * Copyright 2025 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

/**
 * A file in the workspace bundle returned by the studio API.
 */
export interface WorkspaceFile {
  /** Relative path within the workspace */
  readonly path: string;
  /** File content as a string */
  readonly content: string;
}

/**
 * A change detected between the original workspace and the current sandbox state.
 */
export type WorkspaceChangeKind = 'added' | 'modified' | 'deleted';

export interface WorkspaceChange {
  readonly kind: WorkspaceChangeKind;
  readonly path: string;
  /** Content for added/modified files; undefined for deleted */
  readonly content?: string;
}

/**
 * Manifest storing original file state for diffing.
 * Maps relative path -> SHA-256 content hash.
 */
export type WorkspaceManifest = ReadonlyMap<string, string>;

/**
 * Result returned by fetchWorkspace.
 */
export interface FetchWorkspaceResult {
  readonly fileCount: number;
  readonly sandboxPath: string;
}

/**
 * Result returned by submitDiff.
 */
export interface SubmitDiffResult {
  readonly added: number;
  readonly modified: number;
  readonly deleted: number;
}

/**
 * Response shape from the studio workspace bundle API.
 */
export interface WorkspaceBundleResponse {
  readonly files: readonly WorkspaceFile[];
}

/**
 * Logger interface matching the project standard.
 */
export interface Logger {
  info(event: string, data?: Record<string, unknown>): void;
  warn(event: string, data?: Record<string, unknown>): void;
  error(event: string, data?: Record<string, unknown>): void;
}

/**
 * Configuration for workspace tools.
 */
export interface WorkspaceToolsConfig {
  /** Base URL for the studio API */
  readonly studioBaseUrl: string;
  /** Logger instance */
  readonly logger: Logger;
}
