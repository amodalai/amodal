/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

/** Tool call kind — HTTP method or tool action type. */
type Kind = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'LIST' | 'READ' | 'WRITE' | (string & Record<never, never>);
/** HTTP methods that mutate state. */
const MUTATOR_KINDS: readonly string[] = ['POST', 'PUT', 'PATCH', 'DELETE'] as const;
import type {
  AuditConfig,
  AuditContext,
  AuditEntry,
  AuditOutput,
} from './audit-types.js';
import {
  ConsoleAuditOutput,
  FileAuditOutput,
  RemoteAuditOutput,
} from './audit-outputs.js';
import { redactSensitiveParams } from './audit-redact.js';

/**
 * Structured audit logger. Emits entries to configured outputs.
 *
 * Audit must never throw or crash the process — all errors are swallowed.
 */
export class AuditLogger {
  private readonly outputs: AuditOutput[];
  private readonly config: AuditConfig;
  private readonly context: AuditContext;

  constructor(config: AuditConfig, context: AuditContext) {
    this.config = config;
    this.context = context;
    this.outputs = this.createOutputs(config);
  }

  /**
   * Log a tool call event.
   */
  logToolCall(
    name: string,
    params?: Record<string, unknown>,
    durationMs?: number,
  ): void {
    this.emit({
      event: 'tool_call',
      tool: name,
      params,
      duration_ms: durationMs,
    });
  }

  /**
   * Log a write operation event (mutations: edit, delete, move, execute).
   */
  logWriteOp(
    name: string,
    params?: Record<string, unknown>,
    durationMs?: number,
  ): void {
    this.emit({
      event: 'write_op',
      tool: name,
      params,
      duration_ms: durationMs,
    });
  }

  /**
   * Log session start.
   */
  logSessionStart(): void {
    this.emit({ event: 'session_start' });
  }

  /**
   * Log session end.
   */
  logSessionEnd(): void {
    this.emit({ event: 'session_end' });
  }

  /**
   * Log a version bundle load.
   */
  logVersionLoad(version: string): void {
    this.emit({
      event: 'version_load',
      params: { version },
    });
  }

  /**
   * Log a knowledge base proposal event.
   */
  logKbProposal(scope: string, title: string, proposalId?: string): void {
    this.emit({
      event: 'kb_proposal',
      params: { scope, title, proposal_id: proposalId },
    });
  }

  /**
   * Flush all outputs that support it.
   */
  async flush(): Promise<void> {
    const promises = this.outputs
      .filter((o) => o.flush)
      .map((o) => o.flush!());
    await Promise.allSettled(promises);
  }

  /**
   * Check whether a tool kind represents a write/mutation operation.
   */
  static isWriteOperation(kind: Kind): boolean {
    return MUTATOR_KINDS.includes(kind);
  }

  private emit(
    partial: Omit<AuditEntry, 'timestamp' | 'version' | 'session_id' | 'user' | 'role' | 'source'>,
  ): void {
    if (!this.config.enabled) {
      return;
    }

    try {
      const entry: AuditEntry = {
        timestamp: new Date().toISOString(),
        version: this.context.version,
        session_id: this.context.sessionId,
        user: this.context.user,
        role: this.context.role,
        source: this.context.source,
        ...partial,
      };

      // Redact sensitive params if configured
      if (this.config.redactParams && entry.params) {
        entry.params = redactSensitiveParams(entry.params);
      }

      for (const output of this.outputs) {
        try {
          output.write(entry);
        } catch {
          // Swallow — individual output failure must not affect others
        }
      }
    } catch {
      // Swallow — audit must never crash the process
    }
  }

  private createOutputs(config: AuditConfig): AuditOutput[] {
    const outputs: AuditOutput[] = [];
    for (const type of config.outputs) {
      if (type === 'console') {
        outputs.push(new ConsoleAuditOutput());
      } else if (type === 'file' && config.filePath) {
        outputs.push(new FileAuditOutput(config.filePath));
      } else if (type === 'remote' && config.remoteUrl) {
        outputs.push(new RemoteAuditOutput(config.remoteUrl));
      }
    }
    return outputs;
  }
}
