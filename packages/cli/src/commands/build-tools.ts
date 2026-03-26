/**
 * @license
 * Copyright 2025 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import {createHash} from 'node:crypto';
import {readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync} from 'node:fs';
import {join, relative} from 'node:path';
import {execSync} from 'node:child_process';
import type {LoadedTool} from '@amodalai/core';
import type {BuildManifest} from './build-manifest-types.js';

/**
 * Recursively list all files in a directory, returning paths relative to root.
 * Skips node_modules, .git, __pycache__.
 */
export function listFilesRecursive(dir: string, root?: string): string[] {
  const base = root ?? dir;
  const results: string[] = [];
  try {
    const entries = readdirSync(dir, {withFileTypes: true});
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (['node_modules', '.git', '__pycache__', '.venv', 'dist'].includes(entry.name)) {
          continue;
        }
        results.push(...listFilesRecursive(fullPath, base));
      } else if (entry.isFile()) {
        results.push(relative(base, fullPath));
      }
    }
  } catch {
    // Directory unreadable
  }
  return results;
}

/**
 * Compute a content hash for all files in the tool directory (recursive).
 */
function computeToolHash(tool: LoadedTool): string {
  const hash = createHash('sha256');
  const files = listFilesRecursive(tool.location);

  for (const relPath of files) {
    hash.update(`file:${relPath}:`);
    try {
      hash.update(readFileSync(join(tool.location, relPath)));
    } catch {
      hash.update('unreadable');
    }
  }

  hash.update(`sandbox-language:${tool.sandboxLanguage}`);

  return hash.digest('hex');
}

/**
 * Load the existing build manifest if it exists.
 */
function loadExistingManifest(repoPath: string): BuildManifest | null {
  const manifestPath = join(repoPath, '.amodal', 'build-manifest.json');
  if (!existsSync(manifestPath)) {
    return null;
  }
  try {
    const content = readFileSync(manifestPath, 'utf-8');
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
    return JSON.parse(content) as BuildManifest;
  } catch {
    return null;
  }
}

/**
 * Read the platform config from amodal.json.
 */
function getPlatformConfig(repoPath: string): {apiUrl: string; apiKey: string} | null {
  try {
    const configPath = join(repoPath, 'amodal.json');
    const raw = JSON.parse(readFileSync(configPath, 'utf-8'));
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
    const config = raw as Record<string, unknown>;
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
    const platform = config['platform'] as {projectId?: string; apiKey?: string} | undefined;
    if (!platform?.apiKey) return null;

    const apiUrl = (process.env['PLATFORM_API_URL'] ?? 'https://api.amodal.dev').replace(/\/$/, '');
    return {apiUrl, apiKey: platform.apiKey};
  } catch {
    return null;
  }
}

/**
 * Create a tar.gz archive of the tool directory.
 * Excludes node_modules, .git, __pycache__, etc.
 */
export function createToolArchive(tool: LoadedTool): Buffer {
  // Use system tar — available on macOS and Linux
  const tarOutput = execSync(
    'tar -czf - ' +
    '--exclude=node_modules --exclude=.git --exclude=__pycache__ ' +
    '--exclude=.venv --exclude=dist ' +
    '-C ' + JSON.stringify(tool.location) + ' .',
    {maxBuffer: 50 * 1024 * 1024}, // 50MB max
  );
  return Buffer.from(tarOutput);
}

const POLL_INTERVAL_MS = 3000;
const POLL_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes max

/**
 * Upload a tool bundle to the platform API and wait for the build to complete.
 *
 * 1. POST /api/tools/build — starts the build (Vercel creates a Daytona
 *    sandbox, uploads files, kicks off setup commands asynchronously)
 * 2. Poll GET /api/tools/build/:id — waits for setup to finish, then
 *    the platform snapshots the sandbox and returns the snapshotId
 *
 * The ISV never needs Daytona credentials. The platform owns the infra.
 */
async function buildToolOnPlatform(
  platformUrl: string,
  apiKey: string,
  tool: LoadedTool,
  imageHash: string,
): Promise<string> {
  const archive = createToolArchive(tool);
  const fileCount = listFilesRecursive(tool.location).length;

  process.stderr.write(`[build-tools] ${tool.name}: uploading ${fileCount} files (${(archive.length / 1024).toFixed(1)} KB)\n`);

  // 1. Start the build
  const startResponse = await fetch(`${platformUrl}/api/tools/build`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/gzip',
      'X-Tool-Name': tool.name,
      'X-Tool-Hash': imageHash,
      'X-Sandbox-Language': tool.sandboxLanguage,
      'X-Has-Setup-Script': String(tool.hasSetupScript),
      'X-Has-Requirements-Txt': String(tool.hasRequirementsTxt),
      'X-Has-Dockerfile': String(tool.hasDockerfile),
      'X-Has-Package-Json': String(tool.hasPackageJson),
    },
    body: archive,
  });

  if (!startResponse.ok) {
    const text = await startResponse.text().catch(() => '');
    throw new Error(`Platform tool build failed to start (${startResponse.status}): ${text}`);
  }

  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
  const buildResult = await startResponse.json() as {id: string; status: string; snapshotId?: string; error?: string};

  // If already complete (no setup needed), return immediately
  if (buildResult.status === 'complete' && buildResult.snapshotId) {
    return buildResult.snapshotId;
  }
  if (buildResult.status === 'failed') {
    throw new Error(`Tool build failed: ${buildResult.error ?? 'unknown error'}`);
  }

  // 2. Poll until complete
  const buildId = buildResult.id;
  const startTime = Date.now();

  while (Date.now() - startTime < POLL_TIMEOUT_MS) {
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));

    const pollResponse = await fetch(`${platformUrl}/api/tools/build/${buildId}`, {
      headers: {'Authorization': `Bearer ${apiKey}`},
    });

    if (!pollResponse.ok) {
      throw new Error(`Failed to poll build status (${pollResponse.status})`);
    }

    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
    const poll = await pollResponse.json() as {status: string; snapshotId?: string; error?: string};

    if (poll.status === 'complete' && poll.snapshotId) {
      return poll.snapshotId;
    }
    if (poll.status === 'failed') {
      throw new Error(`Tool build failed: ${poll.error ?? 'unknown error'}`);
    }

    process.stderr.write(`[build-tools] ${tool.name}: ${poll.status}...\n`);
  }

  throw new Error(`Tool build timed out after ${POLL_TIMEOUT_MS / 1000}s`);
}

/**
 * Build Daytona sandbox snapshots for custom tools.
 *
 * For each tool:
 * 1. Compute a content hash of all files in the tool directory
 * 2. If hash matches existing manifest entry, skip (cached)
 * 3. Otherwise, upload to the platform API which builds the image
 *    and creates the Daytona snapshot using the platform's Daytona key
 *
 * The ISV never touches Daytona directly. The platform owns the infra.
 *
 * Writes .amodal/build-manifest.json locally for caching.
 * The manifest is also included in the deploy snapshot.
 */
export async function buildToolTemplates(
  repoPath: string,
  tools: LoadedTool[],
): Promise<BuildManifest> {
  const existing = loadExistingManifest(repoPath);
  const existingTools = existing?.tools ?? {};

  const platform = getPlatformConfig(repoPath);

  const builtTools: Record<string, {snapshotId: string; imageHash: string; sandboxLanguage: string; hasDockerfile: boolean; hasSetupScript: boolean}> = {};
  let skipped = 0;
  let built = 0;

  for (const tool of tools) {
    const imageHash = computeToolHash(tool);
    const existingEntry = existingTools[tool.name];

    if (existingEntry && existingEntry.imageHash === imageHash) {
      builtTools[tool.name] = existingEntry;
      skipped++;
      process.stderr.write(`[build-tools] ${tool.name}: cached (hash match)\n`);
      continue;
    }

    if (tool.hasSetupScript) {
      process.stderr.write(`[build-tools] ${tool.name}: building with setup.sh (${tool.sandboxLanguage})\n`);
    } else {
      process.stderr.write(`[build-tools] ${tool.name}: building (${tool.sandboxLanguage})\n`);
    }

    let snapshotId: string;
    if (platform) {
      // Upload to platform API → platform builds on Daytona
      snapshotId = await buildToolOnPlatform(platform.apiUrl, platform.apiKey, tool, imageHash);
    } else {
      // No platform configured — generate a placeholder
      // (local dev mode — tools run in-process, snapshots not needed)
      snapshotId = `local-${imageHash.slice(0, 16)}`;
      process.stderr.write(`[build-tools] ${tool.name}: no platform configured, using local placeholder\n`);
    }

    builtTools[tool.name] = {snapshotId, imageHash, sandboxLanguage: tool.sandboxLanguage, hasDockerfile: tool.hasDockerfile, hasSetupScript: tool.hasSetupScript};
    built++;
    process.stderr.write(`[build-tools] ${tool.name}: snapshot ${snapshotId}\n`);
  }

  const manifest: BuildManifest = {
    version: 1,
    builtAt: new Date().toISOString(),
    tools: builtTools,
  };

  // Write manifest locally for caching
  const amodalDir = join(repoPath, '.amodal');
  if (!existsSync(amodalDir)) {
    mkdirSync(amodalDir, {recursive: true});
  }
  writeFileSync(
    join(amodalDir, 'build-manifest.json'),
    JSON.stringify(manifest, null, 2),
  );

  process.stderr.write(`[build-tools] Done: ${built} built, ${skipped} cached\n`);

  return manifest;
}
