/**
 * @license
 * Copyright 2025 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import {pathToFileURL} from 'node:url';
import path from 'node:path';
import {mkdirSync} from 'node:fs';
import type {CustomToolExecutor, CustomToolContext, LoadedTool, ToolHandlerDefinition} from '@amodalai/core';

type HandlerFn = (params: Record<string, unknown>, ctx: CustomToolContext) => Promise<unknown>;

interface HandlerModule {
  default: HandlerFn | ToolHandlerDefinition;
}

/**
 * Executes custom tool handlers locally via dynamic import.
 */
export class LocalToolExecutor implements CustomToolExecutor {
  private readonly handlerCache = new Map<string, HandlerModule>();

  async execute(
    tool: LoadedTool,
    params: Record<string, unknown>,
    ctx: CustomToolContext,
  ): Promise<unknown> {
    try {
      const handler = await this.loadHandler(tool);
      const fn = resolveHandlerFn(handler, tool.name);
      const result = await fn(params, ctx);

      // Wrap non-object results
      if (result === null || result === undefined) {
        return {result: null};
      }
      if (typeof result !== 'object' || Array.isArray(result)) {
        return {result};
      }
      return result;
    } catch (err) {
      if (ctx.signal.aborted) {
        return {error: 'Tool execution aborted'};
      }
      const message = err instanceof Error ? err.message : String(err);
      return {error: message};
    }
  }

  dispose(): void {
    this.handlerCache.clear();
  }

  private async loadHandler(tool: LoadedTool): Promise<HandlerModule> {
    const cached = this.handlerCache.get(tool.handlerPath);
    if (cached) {
      return cached;
    }

    // Compile .ts handlers to .mjs before importing
    let importPath = tool.handlerPath;
    if (tool.handlerPath.endsWith('.ts')) {
      const {build} = await import('esbuild');
      const outDir = path.join(path.dirname(tool.handlerPath), '.build');
      const outFile = path.join(outDir, `${tool.name}.mjs`);
      mkdirSync(outDir, {recursive: true});
      await build({
        entryPoints: [tool.handlerPath],
        outfile: outFile,
        bundle: false,
        format: 'esm',
        platform: 'node',
        logLevel: 'warning',
      });
      importPath = outFile;
    }

    const moduleUrl = pathToFileURL(importPath).href;
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- dynamic import returns unknown
    const mod = await import(moduleUrl) as unknown as HandlerModule;

    if (typeof mod.default !== 'function' && !isDefineToolResult(mod.default)) {
      throw new Error(
        `Tool "${tool.name}" handler must export a default function or use defineToolHandler()`,
      );
    }

    this.handlerCache.set(tool.handlerPath, mod);
    return mod;
  }
}

/**
 * Check if a default export is a defineToolHandler result.
 */
function isDefineToolResult(value: unknown): value is ToolHandlerDefinition {
  return (
    typeof value === 'object' &&
    value !== null &&
    '__toolHandler' in value &&
    value['__toolHandler'] === true
  );
}

/**
 * Resolve the actual handler function from a module's default export.
 * Handles both plain functions and defineToolHandler results.
 */
function resolveHandlerFn(mod: HandlerModule, toolName: string): HandlerFn {
  if (typeof mod.default === 'function') {
    return mod.default;
  }
  if (isDefineToolResult(mod.default)) {
    return mod.default.handler;
  }
  throw new Error(`Tool "${toolName}" handler must export a default function or use defineToolHandler()`);
}
