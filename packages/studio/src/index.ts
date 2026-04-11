/**
 * @license
 * Copyright 2025 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

export type {
  StudioBackend,
  DraftFile,
  PublishResult,
  PreviewResult,
} from './backend.js';
export {
  NotImplementedStudioBackend,
  StudioNotImplementedError,
} from './backend.js';

export {
  StudioError,
  StudioStorageError,
  StudioPublishError,
  StudioFeatureUnavailableError,
} from './errors.js';

export type {PGLiteStudioBackendOptions} from './backends/pglite.js';
export {
  PGLiteStudioBackend,
  createPGLiteStudioBackend,
} from './backends/pglite.js';

// `backend-contract` is deliberately NOT re-exported from this barrel.
// `backend-contract.ts` imports vitest at module scope (it's a reusable test
// helper), and re-exporting it here would pull vitest into any production
// consumer of `@amodalai/studio` — which breaks `amodal dev`, the CLI, and
// the runtime, all of which crash on load when vitest's worker state isn't
// initialized. Downstream test files should import via the dedicated
// subpath entry: `import { runStudioBackendContract } from '@amodalai/studio/backend-contract';`
// See `packages/studio/package.json` `exports` field.

export type {
  StudioAuth,
  StudioAuthResult,
  StudioRole,
  StudioUser,
} from './auth.js';

export type {CreateStudioRouterOptions} from './routes.js';
export {createStudioRouter} from './routes.js';
