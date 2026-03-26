/**
 * @license
 * Copyright 2025 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import type {CustomShellExecutor} from '@amodalai/core';

const execFileAsync = promisify(execFile);

/**
 * Executes shell commands locally via child_process.
 */
export class LocalShellExecutor implements CustomShellExecutor {
  async exec(
    command: string,
    timeout: number,
    signal: AbortSignal,
  ): Promise<{stdout: string; stderr: string; exitCode: number}> {
    try {
      const result = await execFileAsync('bash', ['-c', command], {
        timeout,
        signal,
        maxBuffer: 1024 * 1024, // 1MB
      });

      return {
        stdout: result.stdout,
        stderr: result.stderr,
        exitCode: 0,
      };
    } catch (err) {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- Node child_process error
      const execErr = err as {stdout?: string; stderr?: string; code?: number | string; killed?: boolean};

      if (signal.aborted) {
        return {
          stdout: execErr.stdout ?? '',
          stderr: 'Execution aborted',
          exitCode: 130,
        };
      }

      if (execErr.killed) {
        return {
          stdout: execErr.stdout ?? '',
          stderr: execErr.stderr ?? 'Process killed (timeout)',
          exitCode: 137,
        };
      }

      return {
        stdout: execErr.stdout ?? '',
        stderr: execErr.stderr ?? (err instanceof Error ? err.message : String(err)),
        exitCode: typeof execErr.code === 'number' ? execErr.code : 1,
      };
    }
  }
}
