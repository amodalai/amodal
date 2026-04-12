/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import {createServer} from 'node:net';

/**
 * Find a free TCP port, starting from `preferred`. If `preferred` is taken,
 * tries incrementally higher ports up to `preferred + maxAttempts`.
 *
 * Uses the "bind then close" technique: creates a TCP server on the candidate
 * port, reads the actual assigned port, then closes the server. This avoids
 * TOCTOU races better than simply checking if a port is open — the OS reserves
 * the port for the brief lifetime of the server.
 */
export async function findFreePort(preferred: number, maxAttempts = 10): Promise<number> {
  for (let offset = 0; offset < maxAttempts; offset++) {
    const candidate = preferred + offset;
    const port = await tryPort(candidate);
    if (port !== null) return port;
  }
  // Fallback: let the OS pick any available port
  const port = await tryPort(0);
  if (port !== null) return port;
  throw new PortAllocationError(preferred, maxAttempts);
}

/**
 * Attempt to bind a TCP server to the given port. Returns the port number on
 * success, or null if the port is in use.
 */
function tryPort(port: number): Promise<number | null> {
  return new Promise((resolve) => {
    const server = createServer();
    server.once('error', () => {
      resolve(null);
    });
    server.listen(port, '127.0.0.1', () => {
      const addr = server.address();
      const assignedPort = typeof addr === 'object' && addr !== null ? addr.port : null;
      server.close(() => {
        resolve(assignedPort);
      });
    });
  });
}

// ---------------------------------------------------------------------------
// Error
// ---------------------------------------------------------------------------

export class PortAllocationError extends Error {
  readonly preferred: number;
  readonly maxAttempts: number;

  constructor(preferred: number, maxAttempts: number) {
    super(
      `Failed to find a free port starting from ${String(preferred)} ` +
      `after ${String(maxAttempts)} attempts`,
    );
    this.name = 'PortAllocationError';
    this.preferred = preferred;
    this.maxAttempts = maxAttempts;
  }
}
