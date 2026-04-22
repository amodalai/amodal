/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import type {AuthContext} from './middleware/auth.js';

export interface ResolvedScope {
  scopeId: string;
  scopeContext?: Record<string, string>;
}

/**
 * Resolve scope from JWT claims (auth context) or request body.
 * JWT takes precedence. Defaults to '' (agent-level, no scope).
 */
export function resolveScope(
  req: {scope_id?: string; context?: Record<string, string>},
  auth?: AuthContext,
): ResolvedScope {
  const scopeId = auth?.scopeId ?? req.scope_id ?? '';
  const scopeContext = auth?.scopeContext ?? req.context;
  return {scopeId, scopeContext};
}
