/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

/**
 * A record of a scrubbed field value, tracked per session.
 */
export interface ScrubRecord {
  value: string;
  entity: string;
  field: string;
  sensitivity: string;
  policy: 'never_retrieve' | 'retrieve_but_redact' | 'role_gated';
  entityId?: string;
  connectionName: string;
  timestamp: number;
}

/**
 * Result from field scrubbing an API response.
 */
export interface ScrubResult {
  data: unknown;
  records: ScrubRecord[];
  strippedCount: number;
  redactableCount: number;
}

/**
 * A finding from the output guard.
 */
export interface GuardFinding {
  type: 'field_redaction' | 'pattern_match' | 'leak_detected' | 'scope_violation';
  description: string;
  location?: string;
  severity: 'info' | 'warning' | 'critical';
}

/**
 * Result from the output guard.
 */
export interface GuardResult {
  output: string;
  modified: boolean;
  findings: GuardFinding[];
  blocked: boolean;
}

/**
 * Decision from the action gate.
 */
export type GateDecision = 'allow' | 'confirm' | 'review' | 'never';

/**
 * Result from the action gate.
 */
export interface GateResult {
  decision: GateDecision;
  reason?: string;
  escalated: boolean;
  endpointPath: string;
}

/**
 * Error codes for security operations.
 */
export type SecurityErrorCode =
  | 'INVALID_CONFIG'
  | 'SCRUB_FAILED'
  | 'GUARD_FAILED'
  | 'GATE_FAILED';

/**
 * Error thrown during security operations.
 */
export class SecurityError extends Error {
  readonly code: SecurityErrorCode;

  constructor(code: SecurityErrorCode, message: string, cause?: unknown) {
    super(message, {cause});
    this.name = 'SecurityError';
    this.code = code;
  }
}
