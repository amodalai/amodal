/**
 * @license
 * Copyright 2025 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import {execSync} from 'node:child_process';
import {createReadStream} from 'node:fs';
import type {CommandModule} from 'yargs';
import {loadRepo, buildSnapshot, serializeSnapshot, snapshotSizeBytes} from '@amodalai/core';
import {findRepoRoot} from '../shared/repo-discovery.js';
import {PlatformClient} from '../shared/platform-client.js';
import {runValidate} from './validate.js';
import {createRepoTarball} from '../shared/tarball.js';
import {readProjectLink} from './link.js';

export interface DeployOptions {
  cwd?: string;
  message?: string;
  env?: string;
  dryRun?: boolean;
}

/**
 * Get the current user from git config or fallback.
 */
function getCurrentUser(): string {
  try {
    return execSync('git config user.email', {encoding: 'utf-8'}).trim();
  } catch {
    return process.env['USER'] ?? 'unknown';
  }
}

/**
 * Get the current git commit SHA, or undefined if not in a git repo.
 */
function getGitSha(): string | undefined {
  try {
    return execSync('git rev-parse HEAD', {encoding: 'utf-8'}).trim();
  } catch {
    return undefined;
  }
}


/**
 * Deploy to the platform: resolve → validate → snapshot → upload.
 *
 * Returns 0 on success, 1 on error.
 */
export async function runDeploy(options: DeployOptions = {}): Promise<number> {
  let repoPath: string;
  try {
    repoPath = findRepoRoot(options.cwd);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`[deploy] ${msg}\n`);
    return 1;
  }

  // Validate
  process.stderr.write(`[deploy] Validating ${repoPath}...\n`);
  const errors = await runValidate({cwd: repoPath});
  if (errors > 0) {
    process.stderr.write(`[deploy] Validation failed with ${errors} error(s). Fix errors before deploying.\n`);
    return 1;
  }

  // Load repo
  process.stderr.write('[deploy] Loading repo...\n');
  let repo;
  try {
    repo = await loadRepo({localPath: repoPath});
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`[deploy] Failed to load repo: ${msg}\n`);
    return 1;
  }

  // Build snapshot
  const snapshot = buildSnapshot(repo, {
    createdBy: getCurrentUser(),
    source: 'cli',
    commitSha: getGitSha(),
    message: options.message,
  });

  const serialized = serializeSnapshot(snapshot);
  const size = snapshotSizeBytes(serialized);
  const environment = options.env ?? 'production';

  process.stderr.write(`[deploy] Snapshot ${snapshot.deployId} built (${(size / 1024).toFixed(1)} KB)\n`);
  process.stderr.write(`[deploy] Connections: ${Object.keys(snapshot.connections).length}, Skills: ${snapshot.skills.length}, Automations: ${snapshot.automations.length}\n`);

  if (options.dryRun) {
    process.stderr.write(`[deploy] Dry run — would deploy ${snapshot.deployId} to ${environment}\n`);
    return 0;
  }

  // Upload to platform
  process.stderr.write(`[deploy] Uploading to platform (${environment})...\n`);
  let client: PlatformClient;
  try {
    client = await PlatformClient.create();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`[deploy] ${msg}\n`);
    return 1;
  }

  try {
    // Read appId from project link
    const projectLink = await readProjectLink();
    const appId = projectLink?.appId;

    // 1. Upload snapshot to platform API
    const result = await client.uploadSnapshot(snapshot, {environment, appId});
    process.stderr.write(`[deploy] Deployed ${result.id} to ${result.environment}\n`);
    if (result.message) {
      process.stderr.write(`[deploy] Message: ${result.message}\n`);
    }

    // 2. Build runtime-app on the build server
    const buildServerUrl = process.env['BUILD_SERVER_URL'] ?? projectLink?.buildServerUrl;
    if (buildServerUrl && appId) {
      process.stderr.write('[deploy] Building runtime app...\n');
      const tarballPath = await createRepoTarball(repoPath);

      try {
        await client.triggerBuild(buildServerUrl, appId, result.id, createReadStream(tarballPath));
        process.stderr.write(`[deploy] Runtime app built and uploaded.\n`);
      } catch (buildErr: unknown) {
        const msg = buildErr instanceof Error ? buildErr.message : String(buildErr);
        process.stderr.write(`[deploy] Runtime app build failed (non-blocking): ${msg}\n`);
      } finally {
        const {unlinkSync} = await import('node:fs');
        try { unlinkSync(tarballPath); } catch { /* best-effort */ }
      }
    }

    return 0;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`[deploy] Upload failed: ${msg}\n`);
    return 1;
  }
}

export const deployCommand: CommandModule = {
  command: 'push',
  describe: 'Push a deployment to the platform',
  builder: (yargs) =>
    yargs
      .option('message', {
        type: 'string',
        alias: 'm',
        describe: 'Deployment message',
      })
      .option('env', {
        type: 'string',
        describe: 'Target environment (default: production)',
      })
      .option('dry-run', {
        type: 'boolean',
        describe: 'Build snapshot without uploading',
        default: false,
      }),
  handler: async (argv) => {
    const code = await runDeploy({
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      message: argv['message'] as string | undefined,
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      env: argv['env'] as string | undefined,
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      dryRun: argv['dryRun'] as boolean | undefined,
    });
    process.exit(code);
  },
};
