/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

/**
 * Runtime event bus types.
 *
 * These events are emitted by the runtime and streamed to clients over
 * the `/api/events` SSE endpoint. They let the UI react to state changes
 * (session list, automation status, store writes, manifest reloads)
 * without polling.
 *
 * Separate from `SSEEvent` (which lives in sse-types.ts). That is the
 * per-message streaming protocol for chat responses. These runtime events
 * are server-level state changes, not conversation output.
 */

/**
 * All runtime event types. Single source of truth — the union type below
 * is derived from this array, so adding a type here propagates to both
 * compile-time narrowing and runtime iteration (e.g., client subscription
 * registration).
 */
export const RUNTIME_EVENT_TYPES = [
  'session_created',
  'session_updated',
  'session_deleted',
  'automation_triggered',
  'automation_completed',
  'automation_failed',
  'automation_started',
  'automation_stopped',
  'delivery_succeeded',
  'delivery_failed',
  'store_updated',
  'manifest_changed',
  'files_changed',
] as const;

export type RuntimeEventType = typeof RUNTIME_EVENT_TYPES[number];

export interface RuntimeEventBase {
  /** Monotonic sequence number, starts at 1 per server run */
  seq: number;
  /** ISO-8601 timestamp */
  timestamp: string;
  type: RuntimeEventType;
}

export interface SessionCreatedEvent extends RuntimeEventBase {
  type: 'session_created';
  sessionId: string;
  appId: string;
}

export interface SessionUpdatedEvent extends RuntimeEventBase {
  type: 'session_updated';
  sessionId: string;
  appId: string;
  title?: string;
}

export interface SessionDeletedEvent extends RuntimeEventBase {
  type: 'session_deleted';
  sessionId: string;
}

export interface AutomationTriggeredEvent extends RuntimeEventBase {
  type: 'automation_triggered';
  name: string;
  /** 'cron' | 'webhook' | 'manual' */
  source: string;
}

export interface AutomationCompletedEvent extends RuntimeEventBase {
  type: 'automation_completed';
  name: string;
  durationMs: number;
}

export interface AutomationFailedEvent extends RuntimeEventBase {
  type: 'automation_failed';
  name: string;
  error: string;
  durationMs: number;
}

export interface AutomationStartedEvent extends RuntimeEventBase {
  type: 'automation_started';
  name: string;
  intervalMs: number;
}

export interface AutomationStoppedEvent extends RuntimeEventBase {
  type: 'automation_stopped';
  name: string;
}

export interface DeliverySucceededEvent extends RuntimeEventBase {
  type: 'delivery_succeeded';
  automation: string;
  /** 'webhook' or 'callback' */
  targetType: string;
  /** Webhook URL (present only for webhook targets) */
  targetUrl?: string;
  /** HTTP status code (present only for webhook targets) */
  httpStatus?: number;
  durationMs: number;
}

export interface DeliveryFailedEvent extends RuntimeEventBase {
  type: 'delivery_failed';
  automation: string;
  /** 'webhook' or 'callback' */
  targetType: string;
  /** Webhook URL (present only for webhook targets) */
  targetUrl?: string;
  /** HTTP status code if the server responded with an error */
  httpStatus?: number;
  error: string;
  /** Number of attempts made (1 = no retry, 2 = one retry fired). */
  attempts: number;
}

export interface StoreUpdatedEvent extends RuntimeEventBase {
  type: 'store_updated';
  storeName: string;
  /** 'put' | 'delete' | 'batch' */
  operation: string;
  /** Optional count for batch ops */
  count?: number;
}

export interface ManifestChangedEvent extends RuntimeEventBase {
  type: 'manifest_changed';
}

export interface FilesChangedEvent extends RuntimeEventBase {
  type: 'files_changed';
  /** Path relative to repo root, if known */
  path?: string;
}

export type RuntimeEvent =
  | SessionCreatedEvent
  | SessionUpdatedEvent
  | SessionDeletedEvent
  | AutomationTriggeredEvent
  | AutomationCompletedEvent
  | AutomationFailedEvent
  | AutomationStartedEvent
  | AutomationStoppedEvent
  | DeliverySucceededEvent
  | DeliveryFailedEvent
  | StoreUpdatedEvent
  | ManifestChangedEvent
  | FilesChangedEvent;

/** Payload for events minus the seq/timestamp fields that the bus assigns */
export type RuntimeEventPayload<T extends RuntimeEvent = RuntimeEvent> =
  // Distributive conditional: Omit is applied to each union member individually,
  // which preserves the discriminated-union shape (instead of collapsing all
  // members to a union of shared keys).
  T extends unknown ? Omit<T, 'seq' | 'timestamp'> : never;
