/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

/**
 * Public SDK surface for custom tool handlers in agent packages.
 *
 * Tool authors import from this barrel — not from `tools/types.ts`,
 * which holds the runtime-internal `ToolContext` (the registry's view of
 * a tool, distinct from the SDK shape handlers see).
 *
 * @example
 *   // tools/show_preview/handler.ts in @amodalai/agent-admin
 *   import {defineToolHandler} from '@amodalai/types';
 *   import type {ToolContext} from '@amodalai/runtime';
 *
 *   export default defineToolHandler({
 *     description: 'Show an agent card preview inline in chat.',
 *     handler: async (params, ctx: ToolContext) => {
 *       ctx.emit({type: 'block', block: {type: 'agent_card_preview', card: params.card}});
 *       return {ok: true};
 *     },
 *   });
 */

export type {
  ToolContext,
  ToolPermission,
  EmitEvent,
  ToolDbHandle,
} from './context.js';

export {PermissionError} from './context.js';

export type {
  FsBackend,
  RepoFileEntry,
  RepoDirListing,
  RepoMode,
} from './fs/index.js';

export {FsSandboxError} from './fs/index.js';
