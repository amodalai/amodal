/**
 * @license
 * Copyright 2025 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

export { createStudioClient } from './client.js';
export type { StudioClient, StudioClientOptions } from './client.js';
export { StudioFetchError, StudioResponseParseError } from './errors.js';
export type {
  DraftFile,
  PublishResult,
  PreviewResult,
  WorkspaceBundle,
  WorkspaceFile,
  WorkspaceChange,
  WorkspaceChangeAction,
} from './types.js';
