/**
 * @license
 * Copyright 2025 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import {writeFileSync} from 'node:fs';
import {join, resolve} from 'node:path';
import {execSync} from 'node:child_process';
import type {CommandModule} from 'yargs';
import {loadRepo, buildSnapshot, serializeSnapshot, snapshotSizeBytes} from '@amodalai/core';
import {buildToolTemplates} from './build-tools.js';
import {findRepoRoot} from '../shared/repo-discovery.js';
import {runValidate} from './validate.js';

export interface BuildOptions {
  cwd?: string;
  output?: string;
  tools?: boolean;
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
 * Build a deploy snapshot from the local repo.
 *
 * 1. Find repo root
 * 2. Validate configuration
 * 3. Load and resolve repo
 * 4. Build snapshot
 * 5. Write to output file
 */
export async function runBuild(options: BuildOptions = {}): Promise<number> {
  let repoPath: string;
  try {
    repoPath = findRepoRoot(options.cwd);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`[build] ${msg}\n`);
    return 1;
  }

  // Validate first
  process.stderr.write(`[build] Validating ${repoPath}...\n`);
  const errors = await runValidate({cwd: repoPath});
  if (errors > 0) {
    process.stderr.write(`[build] Validation failed with ${errors} error(s). Fix errors before building.\n`);
    return 1;
  }

  // Load repo
  process.stderr.write('[build] Loading repo...\n');
  let repo;
  try {
    repo = await loadRepo({localPath: repoPath});
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`[build] Failed to load repo: ${msg}\n`);
    return 1;
  }

  // Build tool sandbox snapshots if requested
  let buildManifest;
  if (options.tools && repo.tools.length > 0) {
    process.stderr.write(`[build] Building ${repo.tools.length} tool sandbox(es)...\n`);
    buildManifest = await buildToolTemplates(repoPath, repo.tools);
  } else if (options.tools && repo.tools.length === 0) {
    process.stderr.write('[build] No tools found in tools/ directory\n');
  }

  // Build snapshot (includes tool metadata + build manifest if available)
  const snapshot = buildSnapshot(repo, {
    createdBy: getCurrentUser(),
    source: 'cli',
    commitSha: getGitSha(),
    buildManifest,
  });

  // Serialize and write
  const serialized = serializeSnapshot(snapshot);
  const size = snapshotSizeBytes(serialized);
  const outputPath = options.output
    ? resolve(options.output)
    : join(repoPath, 'resolved-config.json');

  writeFileSync(outputPath, serialized);

  process.stderr.write(`[build] Snapshot ${snapshot.deployId} written to ${outputPath}\n`);
  process.stderr.write(`[build] Size: ${(size / 1024).toFixed(1)} KB\n`);
  process.stderr.write(`[build] Connections: ${Object.keys(snapshot.connections).length}, Skills: ${snapshot.skills.length}, Automations: ${snapshot.automations.length}, Knowledge: ${snapshot.knowledge.length}, Tools: ${repo.tools.length}\n`);

  return 0;
}

export const buildCommand: CommandModule = {
  command: 'build',
  describe: 'Build a deploy snapshot from the local repo',
  builder: (yargs) =>
    yargs
      .option('output', {
        type: 'string',
        alias: 'o',
        describe: 'Output file path (default: resolved-config.json)',
      })
      .option('tools', {
        type: 'boolean',
        describe: 'Build Daytona sandbox snapshots for custom tools',
        default: false,
      }),
  handler: async (argv) => {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
    const code = await runBuild({output: argv['output'] as string | undefined, tools: argv['tools'] as boolean | undefined});
    process.exit(code);
  },
};
