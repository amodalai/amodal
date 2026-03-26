/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import { writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { BundleHandler } from './version-bundle-types.js';
import type { FunctionHandlerMap, FunctionToolHandler } from '../tools/function-tool-types.js';

/**
 * Convert a .ts entry filename to .mjs for Node ESM dynamic import.
 */
export function toMjsFilename(filename: string): string {
  return filename.replace(/\.ts$/, '.mjs');
}

/**
 * Write handler source files to disk.
 * Each handler's files are written to `<versionDir>/handlers/<handlerName>/`.
 * Entry .ts files are written as .mjs for ESM compatibility.
 */
export async function writeHandlerFiles(
  handlers: Record<string, BundleHandler>,
  versionDir: string,
): Promise<void> {
  for (const [handlerName, handler] of Object.entries(handlers)) {
    const handlerDir = path.join(versionDir, 'handlers', handlerName);
    await mkdir(handlerDir, { recursive: true });

    for (const [filename, source] of Object.entries(handler.files)) {
      const outputFilename = filename === handler.entry
        ? toMjsFilename(filename)
        : filename;
      await writeFile(path.join(handlerDir, outputFilename), source, 'utf-8');
    }
  }
}

/**
 * Dynamically import handler entry files and extract default exports.
 * Each handler must export a default function matching FunctionToolHandler.
 */
export async function importHandlers(
  handlers: Record<string, BundleHandler>,
  versionDir: string,
): Promise<FunctionHandlerMap> {
  const handlerMap: FunctionHandlerMap = new Map();

  for (const [handlerName, handler] of Object.entries(handlers)) {
    const entryFile = toMjsFilename(handler.entry);
    const entryPath = path.join(
      versionDir,
      'handlers',
      handlerName,
      entryFile,
    );
    const fileUrl = pathToFileURL(entryPath).href;

    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- dynamic import returns unknown module shape
    const mod = await import(fileUrl) as { default?: FunctionToolHandler };

    if (typeof mod.default !== 'function') {
      throw new Error(
        `Handler "${handlerName}" entry "${handler.entry}" does not export a default function`,
      );
    }

    handlerMap.set(handlerName, mod.default);
  }

  return handlerMap;
}

/**
 * Write handler files to disk and import them.
 * Combined convenience function.
 */
export async function loadHandlers(
  handlers: Record<string, BundleHandler>,
  versionDir: string,
): Promise<FunctionHandlerMap> {
  if (Object.keys(handlers).length === 0) {
    return new Map();
  }
  await writeHandlerFiles(handlers, versionDir);
  return importHandlers(handlers, versionDir);
}
