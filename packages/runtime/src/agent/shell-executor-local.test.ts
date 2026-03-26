/**
 * @license
 * Copyright 2025 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import {describe, it, expect} from 'vitest';
import {LocalShellExecutor} from './shell-executor-local.js';

describe('LocalShellExecutor', () => {
  const executor = new LocalShellExecutor();

  it('executes a simple command and captures stdout', async () => {
    const result = await executor.exec('echo "hello world"', 5000, AbortSignal.timeout(10000));
    expect(result.stdout.trim()).toBe('hello world');
    expect(result.exitCode).toBe(0);
  });

  it('captures stderr', async () => {
    const result = await executor.exec('echo "error" >&2', 5000, AbortSignal.timeout(10000));
    expect(result.stderr.trim()).toBe('error');
    expect(result.exitCode).toBe(0);
  });

  it('returns non-zero exit code for failing commands', async () => {
    const result = await executor.exec('exit 42', 5000, AbortSignal.timeout(10000));
    expect(result.exitCode).toBe(42);
  });

  it('returns exit code for command not found', async () => {
    const result = await executor.exec('nonexistent_command_xyz', 5000, AbortSignal.timeout(10000));
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toBeTruthy();
  });

  it('handles timeout', async () => {
    const result = await executor.exec('sleep 60', 100, AbortSignal.timeout(10000));
    // Should kill the process
    expect(result.exitCode).not.toBe(0);
  });

  it('captures both stdout and stderr', async () => {
    const result = await executor.exec(
      'echo "out" && echo "err" >&2',
      5000,
      AbortSignal.timeout(10000),
    );
    expect(result.stdout.trim()).toBe('out');
    expect(result.stderr.trim()).toBe('err');
    expect(result.exitCode).toBe(0);
  });

  it('executes multi-line commands', async () => {
    const result = await executor.exec(
      'x=5; echo $((x * 2))',
      5000,
      AbortSignal.timeout(10000),
    );
    expect(result.stdout.trim()).toBe('10');
    expect(result.exitCode).toBe(0);
  });
});
