/**
 * @license
 * Copyright 2025 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

/**
 * Generates the entry.js content for a sandbox tool wrapper.
 *
 * This script runs inside a Daytona sandbox workspace:
 * 1. Reads invocation payload from /tmp/invocation.json
 * 2. Imports the tool handler
 * 3. Creates a proxy ToolContext (where request() and exec() delegate to the host)
 * 4. Executes the handler
 * 5. Writes JSON result to stdout
 */
export function generateToolHarnessEntry(handlerRelativePath: string): string {
  return `
import {readFileSync} from 'node:fs';
import {execSync} from 'node:child_process';
import handler from '${handlerRelativePath}';

const payload = JSON.parse(readFileSync('/tmp/invocation.json', 'utf-8'));
const {params, callbackUrl} = payload;

// Resolve handler function — supports both plain functions and defineToolHandler
const fn = typeof handler === 'function'
  ? handler
  : (handler.__toolHandler ? handler.handler : handler);

const ctx = {
  async request(connection, endpoint, options) {
    const res = await fetch(callbackUrl + '/request', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({connection, endpoint, ...options}),
    });
    return res.json();
  },
  exec(command, options) {
    try {
      const stdout = execSync(command, {
        cwd: options?.cwd ?? '/tool',
        timeout: options?.timeout ?? payload.timeout ?? 30000,
        maxBuffer: 1024 * 1024,
        encoding: 'utf-8',
      });
      return { stdout, stderr: '', exitCode: 0 };
    } catch (err) {
      return {
        stdout: err.stdout ?? '',
        stderr: err.stderr ?? err.message,
        exitCode: typeof err.status === 'number' ? err.status : 1,
      };
    }
  },
  env(name) {
    return process.env[name];
  },
  log(message) {
    process.stderr.write('[tool] ' + message + '\\n');
  },
  signal: AbortSignal.timeout(payload.timeout ?? 30000),
};

try {
  const result = await fn(params, ctx);
  process.stdout.write(JSON.stringify({result}) + '\\n');
} catch (err) {
  process.stdout.write(JSON.stringify({error: err.message ?? String(err)}) + '\\n');
  process.exit(1);
}
`.trim();
}

/**
 * Generates a default Dockerfile for tools without a custom one.
 *
 * The image contains Node 22 (Alpine), installs npm deps if present,
 * and copies the full tool directory into /tool.
 */
export function generateDefaultDockerfile(hasPackageJson: boolean): string {
  const lines = [
    'FROM node:22-alpine',
    'WORKDIR /tool',
  ];

  if (hasPackageJson) {
    lines.push('COPY package.json package-lock.json* ./');
    lines.push('RUN npm install --production');
  }

  lines.push('COPY . .');
  lines.push('');

  return lines.join('\n');
}
