/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import type {MessageBus} from '@google/gemini-cli-core';
import {RequestTool} from '../tools/request-tool.js';
import type {RequestSecurityConfig} from '../tools/request-tool-types.js';
import type {SessionRuntime} from './session-setup.js';

/**
 * Builds a {@link RequestSecurityConfig} from a session runtime.
 */
function buildSecurityConfig(runtime: SessionRuntime): RequestSecurityConfig {
  return {
    fieldScrubber: runtime.fieldScrubber,
    actionGate: runtime.actionGate,
  };
}

/**
 * Creates a RequestTool with security integration (field scrubbing +
 * action gating) wired from the session runtime.
 */
export function createSecuredRequestTool(
  runtime: SessionRuntime,
  messageBus: MessageBus,
): RequestTool {
  const security = buildSecurityConfig(runtime);
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- _secrets is stored as Record<string, string>
  const sessionEnv = (runtime.connectionsMap['_secrets'] ?? {}) as unknown as Record<string, string>;
  return new RequestTool(
    runtime.connectionsMap,
    messageBus,
    false,
    sessionEnv,
    security,
  );
}

/**
 * Creates a read-only RequestTool with security integration.
 * Used for task agents that should not perform writes.
 */
export function createSecuredReadOnlyRequestTool(
  runtime: SessionRuntime,
  messageBus: MessageBus,
): RequestTool {
  const security = buildSecurityConfig(runtime);
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- _secrets is stored as Record<string, string>
  const sessionEnv = (runtime.connectionsMap['_secrets'] ?? {}) as unknown as Record<string, string>;
  return new RequestTool(
    runtime.connectionsMap,
    messageBus,
    true,
    sessionEnv,
    security,
  );
}
