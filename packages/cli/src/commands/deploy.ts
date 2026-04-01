/**
 * @license
 * Copyright 2025 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import type {CommandModule} from 'yargs';
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
 * Deploy to the platform: validate → tarball → trigger build → poll.
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

  const environment = options.env ?? 'production';

  if (options.dryRun) {
    process.stderr.write(`[deploy] Dry run — would deploy to ${environment}\n`);
    return 0;
  }

  // Create platform client
  let client: PlatformClient;
  try {
    client = await PlatformClient.create();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`[deploy] ${msg}\n`);
    return 1;
  }

  const projectLink = await readProjectLink();
  const appId = projectLink?.appId;

  if (!appId) {
    process.stderr.write('[deploy] No app linked. Run `amodal deploy link` first.\n');
    return 1;
  }

  // Create tarball
  process.stderr.write('[deploy] Creating tarball...\n');
  const tarballPath = await createRepoTarball(repoPath);

  try {
    // Trigger remote build
    process.stderr.write('[deploy] Triggering build...\n');
    const buildResult = await client.triggerRemoteBuild(appId, environment, tarballPath, options.message);
    const buildId = buildResult.buildId;

    process.stderr.write(`[deploy] Build ${buildId} accepted. Waiting for completion...\n`);

    // Poll for completion
    const maxWaitMs = 5 * 60 * 1000; // 5 minutes
    const pollIntervalMs = 3000;
    const startTime = Date.now();

    while (Date.now() - startTime < maxWaitMs) {
      await new Promise((r) => setTimeout(r, pollIntervalMs));

      const status = await client.getBuildStatus(buildId);

      if (status.status === 'complete') {
        process.stderr.write(`[deploy] Deployed ${status.deployId} to ${status.environment ?? environment}\n`);
        return 0;
      }

      if (status.status === 'error') {
        process.stderr.write(`[deploy] Build failed: ${status.error ?? 'unknown error'}\n`);
        return 1;
      }

      // Still building — continue polling
    }

    process.stderr.write(`[deploy] Build timed out after 5 minutes. Build ${buildId} may still be running.\n`);
    return 1;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`[deploy] Deploy failed: ${msg}\n`);
    return 1;
  } finally {
    const {unlinkSync} = await import('node:fs');
    try { unlinkSync(tarballPath); } catch { /* best-effort */ }
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
