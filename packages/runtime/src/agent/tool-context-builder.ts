/**
 * @license
 * Copyright 2025 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import type {CustomToolContext, LoadedTool} from '@amodalai/core';
import type {AgentSession} from './agent-types.js';
import {makeApiRequest} from './request-helper.js';
import {resolveKey} from '../stores/key-resolver.js';

const execFileAsync = promisify(execFile);

/**
 * Build a CustomToolContext for a custom tool invocation.
 */
export function buildToolContext(
  session: AgentSession,
  tool: LoadedTool,
  signal: AbortSignal,
): CustomToolContext {
  // Combine the tool's timeout with the external signal
  const timeoutSignal = AbortSignal.timeout(tool.timeout);
  const combinedSignal = AbortSignal.any([signal, timeoutSignal]);

  return {
    async request(connection, endpoint, params) {
      // For tools with confirm: false, reject non-GET methods
      const method = params?.method ?? 'GET';
      if (tool.confirm === false && method !== 'GET') {
        throw new Error(
          `Tool "${tool.name}" has confirm: false — only GET requests are allowed. ` +
          `Use confirm: true or "review" to enable write operations.`,
        );
      }

      const result = await makeApiRequest(
        session,
        connection,
        method,
        endpoint,
        params?.params,
        params?.data,
        combinedSignal,
      );

      if (result.error) {
        throw new Error(result.error);
      }

      // Try to parse JSON response
      if (result.output) {
        try {
          return JSON.parse(result.output) as unknown;
        } catch {
          return result.output;
        }
      }

      return undefined;
    },

    async store(storeName, payload) {
      if (!session.storeBackend) {
        throw new Error('Store backend not available');
      }
      const storeDef = session.runtime.repo.stores.find((s) => s.name === storeName);
      if (!storeDef) {
        throw new Error(`Store "${storeName}" not found. Available: ${session.runtime.repo.stores.map((s) => s.name).join(', ')}`);
      }
      const key = resolveKey(storeDef.entity.key, payload);
      const appId = session.appId ?? 'local';
      await session.storeBackend.put(appId, storeName, key, payload, {});
      return {key};
    },

    async exec(command, options) {
      const timeout = options?.timeout ?? tool.timeout;

      // Delegate to injected shell executor (e.g., Daytona sandbox) when available
      if (session.shellExecutor) {
        return session.shellExecutor.exec(command, timeout, combinedSignal);
      }

      // Fallback: local execution via child_process
      try {
        const result = await execFileAsync('bash', ['-c', command], {
          timeout,
          signal: combinedSignal,
          cwd: options?.cwd ?? tool.location,
          maxBuffer: 1024 * 1024, // 1MB
        });
        return {stdout: result.stdout, stderr: result.stderr, exitCode: 0};
      } catch (err) {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- Node child_process error
        const execErr = err as {stdout?: string; stderr?: string; code?: number | string; killed?: boolean};
        if (combinedSignal.aborted) {
          return {stdout: execErr.stdout ?? '', stderr: 'Execution aborted', exitCode: 130};
        }
        return {
          stdout: execErr.stdout ?? '',
          stderr: execErr.stderr ?? (err instanceof Error ? err.message : String(err)),
          exitCode: typeof execErr.code === 'number' ? execErr.code : 1,
        };
      }
    },

    env(name) {
      if (!tool.env.includes(name)) {
        return undefined;
      }
      return process.env[name];
    },

    log(message) {
      process.stderr.write(`[tool:${tool.name}] ${message}\n`);
    },

    user: {
      roles: session.runtime.userRoles ?? [],
    },

    signal: combinedSignal,
  };
}
