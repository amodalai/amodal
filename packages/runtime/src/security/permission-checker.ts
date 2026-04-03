/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

/**
 * Permission checker interface for tool execution.
 *
 * Extracted from the request tool so that the same permission pipeline
 * can be used by the agent loop (confirmation flow), egress proxy
 * (Roadmap 5.1), async approval (Roadmap 5.3), and PII detection
 * (Roadmap 5.2).
 *
 * The default implementation reads from access.json via ActionGate.
 * Future implementations can add external policy services, audit
 * logging, or rate limiting.
 */

import type {AccessConfig} from '@amodalai/types';
import {ActionGate} from '@amodalai/core';
import type {GateDecision} from '@amodalai/core';

// ---------------------------------------------------------------------------
// Permission result types
// ---------------------------------------------------------------------------

/**
 * Result of a permission check on a tool call.
 */
export type PermissionResult =
  | {allowed: true; requiresConfirmation?: false}
  | {allowed: true; requiresConfirmation: true; reason: string}
  | {allowed: false; reason: string};

/**
 * Information about the tool call being checked.
 */
export interface PermissionCheckRequest {
  /** The connection being accessed */
  connection: string;
  /** Endpoint path (e.g., "POST /articles") */
  endpointPath: string;
  /** Intent declared by the LLM */
  intent: 'read' | 'write' | 'confirmed_write';
  /** HTTP method */
  method: string;
  /** Request parameters (for threshold evaluation) */
  params?: Record<string, unknown>;
  /** Whether this is from a delegated/task agent */
  isDelegated?: boolean;
  /** Whether plan mode is active */
  planModeActive?: boolean;
  /** Whether the caller is read-only (task agents) */
  readOnly?: boolean;
}

// ---------------------------------------------------------------------------
// Permission checker interface
// ---------------------------------------------------------------------------

/**
 * Interface for checking tool execution permissions.
 *
 * Implementations decide whether a tool call is allowed, requires
 * confirmation, or is blocked. The request tool and agent loop both
 * use this interface — the tool doesn't know how permissions are checked.
 */
export interface PermissionChecker {
  check(request: PermissionCheckRequest): PermissionResult;
}

// ---------------------------------------------------------------------------
// AccessJson implementation
// ---------------------------------------------------------------------------

export interface AccessJsonPermissionCheckerConfig {
  accessConfigs: Map<string, AccessConfig>;
  isDelegated: boolean;
}

/**
 * Permission checker that reads from access.json configuration.
 *
 * Wraps the existing ActionGate to evaluate confirmation tiers,
 * thresholds, and delegation escalation. Adds the intent/method
 * validation that was previously inline in the request tool.
 */
export class AccessJsonPermissionChecker implements PermissionChecker {
  private readonly gate: ActionGate;

  constructor(config: AccessJsonPermissionCheckerConfig) {
    this.gate = new ActionGate({
      accessConfigs: config.accessConfigs,
      isDelegated: config.isDelegated,
    });
  }

  check(request: PermissionCheckRequest): PermissionResult {
    const {method, intent, endpointPath, connection, params, readOnly, planModeActive} = request;
    const isMutating = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method.toUpperCase());

    // Block writes in read-only mode (task agents)
    if (readOnly && isMutating) {
      return {allowed: false, reason: 'Write operations are not allowed in read-only mode'};
    }

    // Block writes in plan mode
    if (planModeActive && isMutating && intent !== 'read') {
      return {allowed: false, reason: 'Write operations are blocked in plan mode. Present your plan for approval first.'};
    }

    // Enforce write intent for mutating methods
    if (isMutating && intent === 'read') {
      return {
        allowed: false,
        reason: `${method.toUpperCase()} requires intent "write" or "confirmed_write", not "read"`,
      };
    }

    // For read-only operations, allow without gate check
    if (!isMutating) {
      return {allowed: true};
    }

    // Evaluate action gate for write operations
    const gateResult = this.gate.evaluate(endpointPath, connection, params);

    return this.gateDecisionToResult(gateResult.decision, gateResult.reason);
  }

  private gateDecisionToResult(decision: GateDecision, reason?: string): PermissionResult {
    switch (decision) {
      case 'allow':
        return {allowed: true};
      case 'confirm':
        return {
          allowed: true,
          requiresConfirmation: true,
          reason: reason ?? 'This operation requires confirmation',
        };
      case 'review':
        return {
          allowed: false,
          reason: reason ?? 'This operation requires human review and cannot be executed by the agent',
        };
      case 'never':
        return {
          allowed: false,
          reason: reason ?? 'This operation is not allowed',
        };
      default: {
        const _exhaustive: never = decision;
        return {allowed: false, reason: `Unknown gate decision: ${String(_exhaustive)}`};
      }
    }
  }
}
