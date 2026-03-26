/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import { z } from 'zod';

/**
 * Types of audit events the system can emit.
 */
export const AuditEventTypeSchema = z.enum([
  'tool_call',
  'session_start',
  'session_end',
  'write_op',
  'version_load',
  'kb_proposal',
]);

export type AuditEventType = z.infer<typeof AuditEventTypeSchema>;

/**
 * Audit source: interactive session or a named automation.
 */
export const AuditSourceSchema = z
  .string()
  .refine(
    (val) => val === 'interactive' || val.startsWith('automation:') || val.startsWith('heartbeat:'),
    { message: 'Source must be "interactive" or "automation:<name>"' },
  );

export type AuditSource = z.infer<typeof AuditSourceSchema>;

/**
 * A single audit log entry.
 */
export const AuditEntrySchema = z.object({
  /** ISO 8601 timestamp */
  timestamp: z.string(),
  /** Active version bundle (defaults to "local") */
  version: z.string(),
  /** Session identifier */
  session_id: z.string(),
  /** User identifier */
  user: z.string(),
  /** Active role name */
  role: z.string(),
  /** Type of event */
  event: AuditEventTypeSchema,
  /** Tool name (for tool_call and write_op events) */
  tool: z.string().optional(),
  /** Tool parameters (may be redacted) */
  params: z.record(z.unknown()).optional(),
  /** Duration in milliseconds */
  duration_ms: z.number().optional(),
  /** Source of the event */
  source: AuditSourceSchema,
});

export type AuditEntry = z.infer<typeof AuditEntrySchema>;

/**
 * Interface for audit output sinks.
 */
export interface AuditOutput {
  /** Write a single audit entry to this output. */
  write(entry: AuditEntry): void;
  /** Flush any buffered entries. Optional for sync outputs. */
  flush?(): Promise<void>;
}

/**
 * Configuration for the audit logging system.
 */
export const AuditConfigSchema = z.object({
  /** Whether audit logging is enabled */
  enabled: z.boolean().default(true),
  /** Output sinks to write to */
  outputs: z.array(z.enum(['console', 'file', 'remote'])).default(['console']),
  /** File path for file output */
  filePath: z.string().optional(),
  /** Remote URL for remote output */
  remoteUrl: z.string().url().optional(),
  /** Whether to redact sensitive params (default true) */
  redactParams: z.boolean().default(true),
});

export type AuditConfig = z.infer<typeof AuditConfigSchema>;

/**
 * Context for creating audit entries — set once at logger creation.
 */
export interface AuditContext {
  version: string;
  sessionId: string;
  user: string;
  role: string;
  source: string;
}

/**
 * An immutable audit entry with hash chain for tamper detection.
 */
export interface ImmutableAuditEntry extends AuditEntry {
  /** Monotonically increasing sequence number within the session */
  sequence: number;
  /** SHA-256 hash of the previous entry (empty string for first) */
  previousHash: string;
  /** SHA-256 hash of this entry (including previousHash) */
  entryHash: string;
}

