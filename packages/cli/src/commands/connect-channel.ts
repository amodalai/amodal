/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

/**
 * `amodal connect channel <name>` — install a channel package and run
 * its interactive setup flow (prompt for credentials, set webhooks, etc.).
 */

 
import {findRepoRoot} from '../shared/repo-discovery.js';
import type {CommandModule} from 'yargs';
import {readFileSync, writeFileSync, existsSync} from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import prompts from 'prompts';
import {ensurePackageJson, pmAdd, toNpmName} from '@amodalai/core';
import type {ChannelPlugin, ChannelSetupContext} from '@amodalai/types';

// eslint-disable-next-line @typescript-eslint/no-empty-object-type -- yargs CommandModule default generic
export const connectChannelCommand: CommandModule<{}, {name: string; 'webhook-url'?: string}> = {
  command: 'channel <name>',
  describe: 'Connect a messaging channel (install + setup)',
  builder: (yargs) =>
    yargs
      .positional('name', {type: 'string', demandOption: true, describe: 'Channel package name or short name'})
      .option('webhook-url', {type: 'string', describe: 'Public webhook URL for this channel'}),
  handler: async (argv) => {
    const code = await runConnectChannel({name: argv.name, webhookUrl: argv['webhook-url']});
    process.exit(code);
  },
};

interface ConnectChannelOptions {
  name: string;
  cwd?: string;
  webhookUrl?: string;
}

async function runConnectChannel(options: ConnectChannelOptions): Promise<number> {
  let repoPath: string;
  try {
    repoPath = findRepoRoot(options.cwd);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`[connect channel] ${msg}\n`);
    return 1;
  }

  const npmName = toNpmName(options.name);

  // Step 1: Install if not present
  const packageDir = path.join(repoPath, 'node_modules', ...npmName.split('/'));
  let alreadyInstalled = false;
  try {
    alreadyInstalled = existsSync(path.join(packageDir, 'package.json'));
  } catch {
    // Not installed
  }

  if (!alreadyInstalled) {
    process.stderr.write(`[connect channel] Installing ${npmName}...\n`);
    try {
      ensurePackageJson(repoPath, 'amodal-project');
      await pmAdd(repoPath, npmName);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      process.stderr.write(`[connect channel] Install failed: ${msg}\n`);
      return 1;
    }
  } else {
    process.stderr.write(`[connect channel] ${npmName} already installed.\n`);
  }

  // Step 2: Load the plugin
  const plugin = await loadChannelPlugin(packageDir, npmName);
  if (!plugin) return 1;

  // Step 3: Add to packages array in amodal.json if not present
  const configPath = path.join(repoPath, 'amodal.json');
  if (!existsSync(configPath)) {
    process.stderr.write('[connect channel] No amodal.json found. Run `amodal init` first.\n');
    return 1;
  }

  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- parsing external JSON
  const config = JSON.parse(readFileSync(configPath, 'utf-8')) as Record<string, unknown>;
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- config.packages is string[]
  const packages = (config['packages'] ?? []) as string[];
  if (!packages.includes(npmName)) {
    packages.push(npmName);
    config['packages'] = packages;
    writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n');
    process.stderr.write(`[connect channel] Added ${npmName} to amodal.json packages.\n`);
  }

  // Step 4: Run plugin setup if available
  if (!plugin.setup) {
    process.stderr.write(`[connect channel] ${plugin.channelType} connected. No interactive setup available.\n`);
    return 0;
  }

  const context = buildSetupContext(repoPath, configPath, config, options.webhookUrl);
  try {
    await plugin.setup(context);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`[connect channel] Setup failed: ${msg}\n`);
    return 1;
  }

  process.stderr.write(`\n✅ Channel "${plugin.channelType}" connected and configured.\n`);
  return 0;
}

async function loadChannelPlugin(
  packageDir: string,
  npmName: string,
): Promise<ChannelPlugin | null> {
  const pkgJsonPath = path.join(packageDir, 'package.json');
  if (!existsSync(pkgJsonPath)) {
    process.stderr.write(`[connect channel] Package "${npmName}" not found in node_modules.\n`);
    return null;
  }

  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- parsing external JSON
  const pkgJson = JSON.parse(readFileSync(pkgJsonPath, 'utf-8')) as Record<string, unknown>;
  const mainField = String(pkgJson['main'] ?? 'dist/index.js');
  const entryPath = path.resolve(packageDir, mainField);

  if (!entryPath.startsWith(path.resolve(packageDir))) {
    process.stderr.write(`[connect channel] Package "${npmName}" has invalid main field.\n`);
    return null;
  }

  try {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- dynamic import
    const mod = await import(pathToFileURL(entryPath).href) as {default?: unknown};
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- validating shape below
    const plugin = mod.default as ChannelPlugin | undefined;

    if (!plugin || typeof plugin.channelType !== 'string' || typeof plugin.createAdapter !== 'function') {
      process.stderr.write(`[connect channel] Package "${npmName}" does not export a valid ChannelPlugin.\n`);
      return null;
    }
    return plugin;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`[connect channel] Failed to load plugin: ${msg}\n`);
    return null;
  }
}

function buildSetupContext(
  repoPath: string,
  configPath: string,
  config: Record<string, unknown>,
  webhookUrl?: string,
): ChannelSetupContext {
  return {
    repoPath,
    config,
    webhookUrl,
    writeEnv: async (key: string, value: string) => {
      const envPath = path.join(repoPath, '.env');
      const existing = existsSync(envPath) ? readFileSync(envPath, 'utf-8') : '';
      const lines = existing.split('\n');
      const idx = lines.findIndex((l) => l.startsWith(`${key}=`));
      if (idx >= 0) {
        lines[idx] = `${key}=${value}`;
      } else {
        lines.push(`${key}=${value}`);
      }
      writeFileSync(envPath, lines.join('\n'));
    },
    updateConfig: async (patch: Record<string, unknown>) => {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- parsing project config
      const current = JSON.parse(readFileSync(configPath, 'utf-8')) as Record<string, unknown>;
      Object.assign(current, patch);
      writeFileSync(configPath, JSON.stringify(current, null, 2) + '\n');
    },
    prompt: async (message: string, options?: {secret?: boolean; default?: string}) => {
      const response = await prompts({
        type: options?.secret ? 'password' : 'text',
        name: 'value',
        message,
        initial: options?.default,
      });
      if (response.value === undefined) {
        throw new Error('Setup cancelled by user');
      }
      return String(response.value);
    },
  };
}
