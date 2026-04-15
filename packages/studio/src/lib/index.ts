/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

/**
 * @amodalai/studio — public API.
 *
 * Exports the backend interface, types, auth hooks, startup hooks,
 * error classes, and utilities that external deployments (e.g. cloud-studio)
 * need to build on top of Studio.
 */

// Backend interface + default implementation
export type { StudioBackend } from './backend.js';
export { DrizzleStudioBackend } from './drizzle-backend.js';

// Types
export type {
  DraftFile,
  PublishResult,
  PreviewResult,
  WorkspaceFile,
  WorkspaceBundle,
  BatchChange,
  BatchChangeAction,
  BatchRequest,
  BatchResponse,
  StudioUser,
} from './types.js';

// Auth
export type { StudioAuth } from './auth.js';
export { getUser, setAuthProvider } from './auth.js';

// Startup / backend factory
export type { BackendFactory } from './startup.js';
export { getBackend, setBackendFactory, resetBackend } from './startup.js';

// Errors
export {
  StudioError,
  StudioStorageError,
  StudioPublishError,
  StudioPathError,
  StudioFeatureUnavailableError,
} from './errors.js';

// Draft path validation
export { validateDraftPath } from './draft-path.js';

// Logger
export { logger } from './logger.js';
export type { Logger } from './logger.js';
