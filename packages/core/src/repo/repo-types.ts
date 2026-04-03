/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

// Re-export pure types from the shared types package.
export type {
  RepoErrorCode,
  LoadedSkill,
  LoadedKnowledge,
  LoadedAutomation,
  LoadedAgent,
  LoadedEval,
  RepoMcpServerConfig,
  AgentBundle,
  RepoLoadOptions,
} from '@amodalai/types';

/**
 * Error thrown during repo loading.
 * This is a runtime class, so it stays in core (not in @amodalai/types).
 */
export class RepoError extends Error {
  readonly code: import('@amodalai/types').RepoErrorCode;

  constructor(code: import('@amodalai/types').RepoErrorCode, message: string, cause?: unknown) {
    super(message, {cause});
    this.name = 'RepoError';
    this.code = code;
  }
}
