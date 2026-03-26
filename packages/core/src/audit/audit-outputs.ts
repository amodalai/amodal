/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import * as fs from 'node:fs';
import type { AuditEntry, AuditOutput } from './audit-types.js';

/**
 * Writes audit entries as JSON lines to stderr.
 * Non-blocking — uses process.stderr.write.
 */
export class ConsoleAuditOutput implements AuditOutput {
  write(entry: AuditEntry): void {
    try {
      process.stderr.write(JSON.stringify(entry) + '\n');
    } catch {
      // Swallow — audit must never crash the process
    }
  }
}

/**
 * Appends audit entries as JSON lines to a file.
 * Fire-and-forget — errors are swallowed.
 */
export class FileAuditOutput implements AuditOutput {
  constructor(private readonly filePath: string) {}

  write(entry: AuditEntry): void {
    // Fire-and-forget append
    fs.promises.appendFile(this.filePath, JSON.stringify(entry) + '\n').catch(
      () => {
        // Swallow — audit must never crash the process
      },
    );
  }
}

/**
 * Buffers audit entries and POSTs them to a remote URL in batches.
 * Auto-flushes at 100 items. Errors are swallowed.
 */
export class RemoteAuditOutput implements AuditOutput {
  private buffer: AuditEntry[] = [];
  private readonly maxBufferSize = 100;

  constructor(private readonly url: string) {}

  write(entry: AuditEntry): void {
    this.buffer.push(entry);
    if (this.buffer.length >= this.maxBufferSize) {
      // Fire-and-forget flush
      void this.flush();
    }
  }

  async flush(): Promise<void> {
    if (this.buffer.length === 0) {
      return;
    }
    const batch = this.buffer;
    this.buffer = [];
    try {
      await fetch(this.url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(batch),
      });
    } catch {
      // Swallow — audit must never crash the process
    }
  }
}
