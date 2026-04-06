/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

/**
 * Dynamic loader for channel plugins.
 *
 * Loading order (first match wins):
 *   1. Local repo: `channels/{type}/index.ts` — compiled with esbuild
 *   2. Installed npm package: `@amodalai/channel-{type}`
 *
 * Both sources must export a default `ChannelPlugin`. Local channels
 * let users iterate on custom adapters (e.g. in-app chat widget)
 * without publishing a package.
 */

import {existsSync, mkdirSync} from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import type {ChannelAdapter, ChannelPlugin} from '@amodalai/types';
import type {Logger} from '../logger.js';
import {ChannelPluginError, ChannelConfigError} from './errors.js';

export interface LoadChannelPluginsOptions {
  /** The `channels` block from amodal.json (env refs already resolved). */
  channelsConfig: Record<string, unknown>;
  /** Absolute path to the repo root (for local channel discovery + node_modules). */
  repoPath: string;
  /** The `packages` array from amodal.json — used to find channel packages. */
  packages?: string[];
  logger: Logger;
}

/**
 * Load and initialize channel adapters for all configured channels.
 */
export async function loadChannelPlugins(
  opts: LoadChannelPluginsOptions,
): Promise<Map<string, ChannelAdapter>> {
  const {channelsConfig, repoPath, logger} = opts;
  const adapters = new Map<string, ChannelAdapter>();

  for (const [channelType, rawConfig] of Object.entries(channelsConfig)) {
    const mod = await importChannelModule(channelType, repoPath, opts.packages ?? [], logger);

    // Validate the default export satisfies ChannelPlugin shape
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- validating shape below
    const plugin = mod.default as ChannelPlugin | undefined;
    if (
      !plugin ||
      typeof plugin.channelType !== 'string' ||
      !plugin.configSchema ||
      typeof plugin.createAdapter !== 'function'
    ) {
      throw new ChannelPluginError(
        `Channel "${channelType}" does not export a valid ChannelPlugin as its default export`,
        {channelType},
      );
    }

    // Validate config against the plugin's schema
    let validatedConfig: unknown;
    try {
      validatedConfig = plugin.configSchema.parse(rawConfig);
    } catch (cause) {
      throw new ChannelConfigError(
        `Invalid config for channel "${channelType}"`,
        {channelType, cause},
      );
    }

    // Create the adapter
    const adapter = plugin.createAdapter(validatedConfig);
    adapters.set(channelType, adapter);
  }

  return adapters;
}

// ---------------------------------------------------------------------------
// Module resolution: local repo first, then npm
// ---------------------------------------------------------------------------

const LOCAL_ENTRY_FILES = ['index.ts', 'index.js', 'index.mjs'];

/**
 * Find a channel package from the declared packages list.
 * Matches packages ending with `channel-{type}` (any scope).
 * E.g. channelType "telegram" matches "@amodalai/channel-telegram" or "@myorg/channel-telegram".
 */
function findChannelPackage(channelType: string, packages: string[]): string | undefined {
  const suffix = `channel-${channelType}`;
  return packages.find((pkg) => {
    const shortName = pkg.split('/').pop() ?? pkg;
    return shortName === suffix;
  });
}

async function importChannelModule(
  channelType: string,
  repoPath: string,
  packages: string[],
  logger: Logger,
): Promise<{default?: unknown}> {
  // 1. Check local repo: channels/{type}/index.ts
  const localDir = path.join(repoPath, 'channels', channelType);
  const localEntry = LOCAL_ENTRY_FILES
    .map((f) => path.join(localDir, f))
    .find((p) => existsSync(p));

  if (localEntry) {
    return importLocalChannel(channelType, localEntry, logger);
  }

  // 2. Find matching package from the declared packages array
  const packageName = findChannelPackage(channelType, packages);
  if (!packageName) {
    throw new ChannelPluginError(
      `Channel "${channelType}" not found. Either create channels/${channelType}/index.ts in your repo, or add a channel-${channelType} package to the packages array in amodal.json.`,
      {channelType},
    );
  }

  // 3. Import from node_modules using the resolved path
  const packageDir = path.join(repoPath, 'node_modules', ...packageName.split('/'));
  const pkgJsonPath = path.join(packageDir, 'package.json');
  if (!existsSync(pkgJsonPath)) {
    throw new ChannelPluginError(
      `Channel package "${packageName}" declared in amodal.json but not installed. Run: npm install`,
      {channelType},
    );
  }

  try {
    const {readFileSync} = await import('node:fs');
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- parsing external JSON
    const pkgJson = JSON.parse(readFileSync(pkgJsonPath, 'utf-8')) as Record<string, unknown>;
    const mainField = String(pkgJson['main'] ?? 'dist/index.js');
    const entryPath = path.join(packageDir, mainField);
    const moduleUrl = pathToFileURL(entryPath).href;
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- dynamic import returns unknown module shape
    const mod = await import(moduleUrl) as {default?: unknown};
    logger.info('channel_plugin_loaded', {channelType, source: 'package', package: packageName});
    return mod;
  } catch (cause) {
    if (cause instanceof ChannelPluginError) throw cause;
    throw new ChannelPluginError(
      `Failed to load channel plugin "${packageName}"`,
      {channelType, cause},
    );
  }
}

async function importLocalChannel(
  channelType: string,
  entryPath: string,
  logger: Logger,
): Promise<{default?: unknown}> {
  let importPath = entryPath;

  // Compile .ts to .mjs with esbuild (same pattern as LocalToolExecutor)
  if (entryPath.endsWith('.ts')) {
    const {build} = await import('esbuild');
    const outDir = path.join(path.dirname(entryPath), '.build');
    const outFile = path.join(outDir, `${channelType}.mjs`);
    mkdirSync(outDir, {recursive: true});
    await build({
      entryPoints: [entryPath],
      outfile: outFile,
      bundle: true,
      format: 'esm',
      platform: 'node',
      logLevel: 'warning',
      // Mark @amodalai/* as external so it resolves from the runtime's
      // node_modules, not bundled into the output.
      external: ['@amodalai/*'],
    });
    importPath = outFile;
  }

  const moduleUrl = pathToFileURL(importPath).href;
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- dynamic import returns unknown module shape
  const mod = await import(moduleUrl) as {default?: unknown};
  logger.info('channel_plugin_loaded', {channelType, source: 'local', path: entryPath});
  return mod;
}
