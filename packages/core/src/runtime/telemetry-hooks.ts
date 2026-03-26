/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import type {ScrubResult, GuardResult, GateResult} from '../security/security-types.js';

/**
 * All telemetry event types the runtime can emit.
 */
export type TelemetryEventType =
  | 'field_scrub'
  | 'output_guard'
  | 'action_gate'
  | 'explore_dispatch'
  | 'plan_mode'
  | 'tool_call'
  | 'session_summary';

/**
 * A telemetry event emitted by the runtime.
 */
export interface RuntimeTelemetryEvent {
  type: TelemetryEventType;
  sessionId: string;
  timestamp: number;
  data: Record<string, unknown>;
}

/**
 * A function that receives telemetry events.
 */
export type TelemetrySink = (event: RuntimeTelemetryEvent) => void;

/**
 * Structured telemetry for runtime security and orchestration events.
 * Each log method constructs a RuntimeTelemetryEvent and sends it
 * to the configured sink. If no sink is provided, all methods are no-ops.
 */
export class RuntimeTelemetry {
  private readonly sessionId: string;
  private readonly sink?: TelemetrySink;

  constructor(sessionId: string, sink?: TelemetrySink) {
    this.sessionId = sessionId;
    this.sink = sink;
  }

  logScrub(result: ScrubResult, connectionName: string, endpointPath: string): void {
    if (!this.sink) return;

    this.sink({
      type: 'field_scrub',
      sessionId: this.sessionId,
      timestamp: Date.now(),
      data: {
        connectionName,
        endpointPath,
        strippedCount: result['strippedCount'],
        redactableCount: result['redactableCount'],
      },
    });
  }

  logGuard(result: GuardResult): void {
    if (!this.sink) return;

    const findingTypes = [...new Set(result['findings'].map((f) => f.type))];

    this.sink({
      type: 'output_guard',
      sessionId: this.sessionId,
      timestamp: Date.now(),
      data: {
        modified: result['modified'],
        blocked: result['blocked'],
        findingCount: result['findings'].length,
        findingTypes,
      },
    });
  }

  logGate(result: GateResult): void {
    if (!this.sink) return;

    this.sink({
      type: 'action_gate',
      sessionId: this.sessionId,
      timestamp: Date.now(),
      data: {
        decision: result['decision'],
        escalated: result['escalated'],
        endpointPath: result['endpointPath'],
      },
    });
  }

  logExplore(query: string, resultTokens: number): void {
    if (!this.sink) return;

    this.sink({
      type: 'explore_dispatch',
      sessionId: this.sessionId,
      timestamp: Date.now(),
      data: {
        query,
        resultTokens,
      },
    });
  }

  logPlanMode(action: 'enter' | 'approve' | 'exit'): void {
    if (!this.sink) return;

    this.sink({
      type: 'plan_mode',
      sessionId: this.sessionId,
      timestamp: Date.now(),
      data: {
        action,
      },
    });
  }

  logToolCall(
    toolName: string,
    durationMs: number,
    tokenCount: number,
    modelProvider?: string,
    modelName?: string,
  ): void {
    if (!this.sink) return;

    this.sink({
      type: 'tool_call',
      sessionId: this.sessionId,
      timestamp: Date.now(),
      data: {
        toolName,
        durationMs,
        tokenCount,
        modelProvider,
        modelName,
      },
    });
  }

  logSessionSummary(summary: {
    totalTokens: number;
    totalDurationMs: number;
    toolCallCount: number;
    scrubCount: number;
    guardCount: number;
    estimatedCostMicros: number;
  }): void {
    if (!this.sink) return;

    this.sink({
      type: 'session_summary',
      sessionId: this.sessionId,
      timestamp: Date.now(),
      data: summary,
    });
  }
}
