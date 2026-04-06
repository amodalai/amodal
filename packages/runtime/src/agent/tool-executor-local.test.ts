/**
 * @license
 * Copyright 2025 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import {describe, it, expect, beforeEach, afterEach} from 'vitest';
import {mkdtempSync, mkdirSync, writeFileSync, rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import type {LoadedTool, CustomToolContext} from '@amodalai/core';
import {LocalToolExecutor} from './tool-executor-local.js';

describe('LocalToolExecutor', () => {
  let tempDir: string;
  let executor: LocalToolExecutor;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'tool-executor-test-'));
    executor = new LocalToolExecutor();
  });

  afterEach(() => {
    executor.dispose();
    rmSync(tempDir, {recursive: true, force: true});
  });

  function createHandler(name: string, code: string): string {
    const handlerDir = join(tempDir, name);
    mkdirSync(handlerDir, {recursive: true});
    // Write as .mjs so dynamic import works without TS compilation
    const handlerPath = join(handlerDir, 'handler.mjs');
    writeFileSync(handlerPath, code);
    return handlerPath;
  }

  function makeTool(handlerPath: string, overrides: Partial<LoadedTool> = {}): LoadedTool {
    return {
      name: 'test_tool',
      description: 'Test tool',
      parameters: {},
      confirm: false,
      timeout: 5000,
      env: [],
      handlerPath,
      location: tempDir,
      hasPackageJson: false,
      hasDockerfile: false,
      hasSetupScript: false,
      hasRequirementsTxt: false,
      sandboxLanguage: 'typescript',
      ...overrides,
    };
  }

  function makeCtx(): CustomToolContext {
    return {
      exec: async () => ({stdout: '', stderr: '', exitCode: 0}),
      request: async () => ({}),
      store: async () => ({key: 'test'}),
      env: () => undefined,
      log: () => {},
      signal: AbortSignal.timeout(10000),
    };
  }

  it('executes a handler that returns an object', async () => {
    const handlerPath = createHandler('obj-handler',
      'export default async (params) => ({ value: params.x * 2 });',
    );
    const tool = makeTool(handlerPath);
    const result = await executor.execute(tool, {x: 5}, makeCtx());
    expect(result).toEqual({value: 10});
  });

  it('wraps non-object return values', async () => {
    const handlerPath = createHandler('num-handler',
      'export default async () => 42;',
    );
    const tool = makeTool(handlerPath);
    const result = await executor.execute(tool, {}, makeCtx());
    expect(result).toEqual({result: 42});
  });

  it('wraps null return values', async () => {
    const handlerPath = createHandler('null-handler',
      'export default async () => null;',
    );
    const tool = makeTool(handlerPath);
    const result = await executor.execute(tool, {}, makeCtx());
    expect(result).toEqual({result: null});
  });

  it('wraps array return values', async () => {
    const handlerPath = createHandler('arr-handler',
      'export default async () => [1, 2, 3];',
    );
    const tool = makeTool(handlerPath);
    const result = await executor.execute(tool, {}, makeCtx());
    expect(result).toEqual({result: [1, 2, 3]});
  });

  it('propagates handler errors', async () => {
    const handlerPath = createHandler('err-handler',
      'export default async () => { throw new Error("boom"); };',
    );
    const tool = makeTool(handlerPath);
    await expect(executor.execute(tool, {}, makeCtx())).rejects.toThrow('boom');
  });

  it('caches imported modules', async () => {
    const handlerPath = createHandler('cache-handler',
      'let count = 0; export default async () => ({ count: ++count });',
    );
    const tool = makeTool(handlerPath);
    const ctx = makeCtx();

    const r1 = await executor.execute(tool, {}, ctx);
    const r2 = await executor.execute(tool, {}, ctx);

    // Both calls use the same module (count increments)
    expect(r1).toEqual({count: 1});
    expect(r2).toEqual({count: 2});
  });

  it('clears cache on dispose', async () => {
    const handlerPath = createHandler('dispose-handler',
      'export default async () => ({ ok: true });',
    );
    const tool = makeTool(handlerPath);

    await executor.execute(tool, {}, makeCtx());
    executor.dispose();

    // After dispose, a new executor needs to reimport
    const executor2 = new LocalToolExecutor();
    const result = await executor2.execute(tool, {}, makeCtx());
    expect(result).toEqual({ok: true});
    executor2.dispose();
  });

  it('throws for handler without default export', async () => {
    const handlerPath = createHandler('no-default',
      'export const handler = async () => ({});',
    );
    const tool = makeTool(handlerPath);
    await expect(executor.execute(tool, {}, makeCtx())).rejects.toThrow();
  });
});
