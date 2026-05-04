/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

/**
 * Load intents from `<repoPath>/intents/<id>/intent.ts`. Each subdir is
 * one intent; its `intent.ts` default-exports an `IntentDefinition`.
 *
 * Compiles each entry with esbuild (same approach as `tool-executor-local`
 * uses for tool handlers) so authors can split helpers across sibling
 * `.ts` files inside the intent's directory. Output goes into a
 * sibling `.build/` directory so the source tree stays clean.
 *
 * Skipped silently when:
 *   - `<repoPath>/intents/` doesn't exist (most agents don't have intents)
 *   - A subdir has no `intent.ts` (probably a future siblings dir)
 *
 * Throws when:
 *   - `intent.ts` exists but the default export isn't a valid
 *     IntentDefinition shape (caller surface, fail fast)
 */

import {existsSync, mkdirSync} from 'node:fs';
import {readdir, stat} from 'node:fs/promises';
import * as path from 'node:path';
import {pathToFileURL} from 'node:url';
import type {IntentDefinition} from '@amodalai/types';

interface IntentModule {
  default: IntentDefinition;
}

/**
 * Read the intents directory and return a sorted list of loaded
 * IntentDefinitions. Empty array when the directory is missing.
 *
 * Sort order is alphabetical by directory name. `matchIntent` walks
 * the list in registration order, so the directory name controls
 * which regex is tested first when two intents could match the same
 * input. Author intent ids accordingly (the id IS the directory name).
 */
export async function loadIntents(repoPath: string): Promise<IntentDefinition[]> {
  const intentsDir = path.join(repoPath, 'intents');
  if (!existsSync(intentsDir)) return [];

  let dirEntries: string[];
  try {
    dirEntries = await readdir(intentsDir);
  } catch {
    return [];
  }
  dirEntries.sort();

  const loaded: IntentDefinition[] = [];
  for (const name of dirEntries) {
    if (name.startsWith('.') || name.startsWith('_')) continue;
    const subdirPath = path.join(intentsDir, name);
    let stats;
    try {
      stats = await stat(subdirPath);
    } catch {
      continue;
    }
    if (!stats.isDirectory()) continue;

    const intentFile = path.join(subdirPath, 'intent.ts');
    if (!existsSync(intentFile)) continue;

    const def = await loadIntentModule(name, intentFile);
    loaded.push(def);
  }
  return loaded;
}

/**
 * Compile + import a single intent.ts. esbuild runs with
 * `bundle: true, packages: 'external'` so sibling .ts helpers get
 * inlined while npm + node:* imports stay external for normal
 * Node resolution.
 */
async function loadIntentModule(
  dirName: string,
  intentFilePath: string,
): Promise<IntentDefinition> {
  const buildDir = path.join(path.dirname(intentFilePath), '.build');
  const outFile = path.join(buildDir, 'intent.mjs');
  mkdirSync(buildDir, {recursive: true});

  const {build} = await import('esbuild');
  await build({
    entryPoints: [intentFilePath],
    outfile: outFile,
    bundle: true,
    packages: 'external',
    format: 'esm',
    platform: 'node',
    target: 'node20',
    logLevel: 'warning',
  });

  const moduleUrl = pathToFileURL(outFile).href;
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- dynamic import boundary; validated below
  const mod = (await import(moduleUrl)) as IntentModule;

  const def = mod.default;
  if (!isValidIntentDefinition(def)) {
    throw new Error(
      `Intent "${dirName}" at ${intentFilePath} must default-export an IntentDefinition with {id: string, regex: RegExp, handle: function}.`,
    );
  }

  if (def.id !== dirName) {
    throw new Error(
      `Intent at ${intentFilePath} has id "${def.id}" but lives in directory "${dirName}". The id must match the directory name.`,
    );
  }

  return def;
}

function isValidIntentDefinition(value: unknown): value is IntentDefinition {
  if (typeof value !== 'object' || value === null) return false;
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- discriminating shape check
  const v = value as Record<string, unknown>;
  return (
    typeof v['id'] === 'string' &&
    v['regex'] instanceof RegExp &&
    typeof v['handle'] === 'function'
  );
}
