/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import {statSync} from 'node:fs';
import {join} from 'node:path';

import type {CommandModule} from 'yargs';
import prompts from 'prompts';
import {
  ensurePackageJson,
  findMissingEnvVars,
  pmAdd,
  readPackageManifest,
  toNpmName,
  upsertEnvEntries,
} from '@amodalai/core';
import type {PackageAuth} from '@amodalai/core';

import {findRepoRoot} from '../shared/repo-discovery.js';
import {promptForCredentials, runOAuth2Flow, testConnection} from '../auth/index.js';

export interface ConnectOptions {
  cwd?: string;
  name: string;
  force?: boolean;
}

/**
 * Connect a connection package: install (if needed) + auth + test.
 * Returns 0 on success, 1 on error.
 */
export async function runConnect(options: ConnectOptions): Promise<number> {
  let repoPath: string;
  try {
    repoPath = findRepoRoot(options.cwd);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`[connect] ${msg}\n`);
    return 1;
  }

  const npmName = toNpmName(options.name);
  const packageDir = join(repoPath, 'node_modules', npmName);

  // Check if already installed by looking in node_modules
  let isReconnect = false;
  try {
    isReconnect = statSync(packageDir).isDirectory();
  } catch {
    // Not installed
  }

  // Step 1: Install if fresh
  if (!isReconnect) {
    process.stderr.write(`[connect] Installing ${npmName}...\n`);
    try {
      ensurePackageJson(repoPath, 'amodal-project');
      await pmAdd(repoPath, npmName);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      process.stderr.write(`[connect] Install failed: ${msg}\n`);
      return 1;
    }
  } else {
    process.stderr.write(`[connect] ${options.name} already installed. Running auth + test.\n`);
  }

  // Step 2: Read manifest
  let manifest;
  try {
    manifest = await readPackageManifest(packageDir);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`[connect] Failed to read package manifest: ${msg}\n`);
    return 1;
  }

  // Step 3: Auth flow
  const envFilePath = join(repoPath, '.env');
  const auth: PackageAuth | undefined = manifest.auth;

  if (!auth) {
    process.stderr.write('[connect] No authentication required.\n');
  } else {
    const authResult = await runAuthFlow(auth, envFilePath, options.force ?? false, isReconnect);
    if (authResult === 'cancelled') {
      process.stderr.write('[connect] Auth cancelled.\n');
      return 1;
    }
  }

  // Step 4: Test connection
  const testEndpoints = manifest.testEndpoints;
  if (testEndpoints && testEndpoints.length > 0) {
    process.stderr.write('[connect] Testing connection...\n');
    const report = await testConnection({
      connectionName: options.name,
      testEndpoints,
      envFilePath,
      auth,
    });
    if (!report.allPassed) {
      process.stderr.write(`[connect] Connection test failed. ${report.results.filter((r) => r.status === 'error').length} endpoint(s) unreachable.\n`);
      return 1;
    }
    process.stderr.write('[connect] All tests passed.\n');
  } else {
    process.stderr.write('[connect] No test endpoints configured. Skipping test.\n');
  }

  process.stderr.write(`[connect] Connected: ${options.name}\n`);
  return 0;
}

/**
 * Run the auth flow based on auth type.
 * Returns 'cancelled' if user cancelled, 'ok' otherwise.
 */
async function runAuthFlow(
  auth: PackageAuth,
  envFilePath: string,
  force: boolean,
  isReconnect: boolean,
): Promise<'ok' | 'cancelled'> {
  switch (auth.type) {
    case 'oauth2': {
      // Prompt for clientId
      const idResponse = await prompts({
        type: 'text',
        name: 'clientId',
        message: 'OAuth2 Client ID',
      });
      if (idResponse['clientId'] === undefined) return 'cancelled';

      // Optionally prompt for clientSecret
      const secretResponse = await prompts({
        type: 'password',
        name: 'clientSecret',
        message: 'OAuth2 Client Secret (leave empty if not required)',
      });

      const result = await runOAuth2Flow({
        authorizeUrl: auth['authorizeUrl'],
        tokenUrl: auth['tokenUrl'],
        scopes: auth['scopes'],
        envVars: auth['envVars'],
        // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
        clientId: idResponse['clientId'] as string,
        // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
        clientSecret: (secretResponse['clientSecret'] as string) || undefined,
      });

      await upsertEnvEntries(envFilePath, result.credentials);
      process.stderr.write(`[connect] ${result.summary}\n`);
      return 'ok';
    }

    case 'bearer':
    case 'api_key': {
      if (force || !isReconnect) {
        // Fresh install or force: always prompt
        const result = await promptForCredentials({auth, envFilePath});
        process.stderr.write(`[connect] ${result.summary}\n`);
        if (result.summary.startsWith('Cancelled')) return 'cancelled';
        return 'ok';
      }

      // Reconnect without force: only prompt if vars are missing
      const required = getEnvVarNames(auth);
      const missing = await findMissingEnvVars(envFilePath, required);
      if (missing.length === 0) {
        process.stderr.write('[connect] Credentials already configured.\n');
        return 'ok';
      }

      const result = await promptForCredentials({auth, envFilePath});
      process.stderr.write(`[connect] ${result.summary}\n`);
      if (result.summary.startsWith('Cancelled')) return 'cancelled';
      return 'ok';
    }

    default:
      break;
  }

  return 'ok';
}

/**
 * Extract env var names from auth config.
 */
function getEnvVarNames(auth: PackageAuth): string[] {
  const vars: string[] = [];
  if (auth['envVars']) {
    vars.push(...Object.keys(auth['envVars']));
  }
  if (auth.type === 'api_key' && auth['headers']) {
    for (const value of Object.values(auth['headers'])) {
      const match = /\$\{?([A-Z_][A-Z0-9_]*)\}?/.exec(value);
      if (match && !vars.includes(match[1])) {
        vars.push(match[1]);
      }
    }
  }
  return vars;
}

export const connectCommand: CommandModule = {
  command: 'connect <name>',
  describe: 'Connect a connection package (install + auth + test)',
  builder: (yargs) =>
    yargs
      .positional('name', {type: 'string', demandOption: true, describe: 'Connection name'})
      .option('force', {type: 'boolean', default: false, describe: 'Force re-authentication'}),
  handler: async (argv) => {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
    const code = await runConnect({name: argv['name'] as string, force: argv['force'] as boolean});
    process.exit(code);
  },
};
