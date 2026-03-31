/**
 * @license
 * Copyright 2025 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import {execFile} from 'node:child_process';
import {mkdir, readdir, readFile, rm, stat} from 'node:fs/promises';
import * as path from 'node:path';
import {homedir} from 'node:os';
import {promisify} from 'node:util';
const execFileAsync = promisify(execFile);

const ADMIN_AGENT_NPM = '@amodalai/agent-admin';
const DEFAULT_REGISTRY = 'https://registry.amodalai.com';
const CACHE_DIR_NAME = 'admin-agent';
const FETCH_TIMEOUT = 30_000;

/**
 * Get the global cache directory for the admin agent.
 */
export function getAdminCacheDir(): string {
  return path.join(homedir(), '.amodal', CACHE_DIR_NAME);
}

/**
 * Resolve the admin agent directory. Checks in order:
 * 1. adminAgent path from amodal.json (explicit override)
 * 2. Global cache at ~/.amodal/admin-agent/
 *
 * Returns null if not found (caller should fetch).
 */
export async function resolveAdminAgent(repoPath?: string): Promise<string | null> {
  // 1. Check amodal.json override
  if (repoPath) {
    try {
      const configPath = path.join(repoPath, 'amodal.json');
      const configRaw = await readFile(configPath, 'utf-8');
      const configParsed: unknown = JSON.parse(configRaw);
      if (!configParsed || typeof configParsed !== 'object') throw new Error('invalid');
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- guarded above
      const adminPath = (configParsed as Record<string, unknown>)['adminAgent'];
      if (typeof adminPath === 'string') {
        const resolved = path.resolve(repoPath, adminPath);
        if (await dirHasContent(resolved)) {
          return resolved;
        }
      }
    } catch {
      // No config or no adminAgent field
    }
  }

  // 2. Check global cache
  const cacheDir = getAdminCacheDir();
  if (await dirHasContent(cacheDir)) {
    return cacheDir;
  }

  return null;
}

/**
 * Fetch the admin agent from the registry and cache it.
 * Returns the cache directory path.
 */
export async function fetchAdminAgent(registryUrl?: string): Promise<string> {
  const registry = registryUrl ?? process.env['AMODAL_REGISTRY'] ?? DEFAULT_REGISTRY;
  const cacheDir = getAdminCacheDir();

  // Create a temp directory for npm pack
  const tmpDir = path.join(homedir(), '.amodal', '.tmp-admin-fetch');
  await mkdir(tmpDir, {recursive: true});

  try {
    // Download the package tarball
    const {stdout} = await execFileAsync(
      'npm',
      ['pack', ADMIN_AGENT_NPM, '--registry', registry, '--pack-destination', tmpDir, '--json'],
      {cwd: tmpDir, timeout: FETCH_TIMEOUT},
    );

    // Parse the output to find the tarball filename
    let tarballName: string;
    try {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- npm pack JSON output
      const parsed = JSON.parse(stdout) as Array<{filename: string}>;
      tarballName = parsed[0]?.filename ?? '';
    } catch {
      // Fallback: find the .tgz file in the tmp dir
      const files = await readdir(tmpDir);
      tarballName = files.find((f) => f.endsWith('.tgz')) ?? '';
    }

    if (!tarballName) {
      throw new Error('Failed to download admin agent package');
    }

    const tarballPath = path.join(tmpDir, tarballName);

    // Clear existing cache
    await rm(cacheDir, {recursive: true, force: true});
    await mkdir(cacheDir, {recursive: true});

    // Extract tarball: npm pack creates package/ prefix
    await execFileAsync('tar', ['xzf', tarballPath, '-C', cacheDir, '--strip-components=1'], {
      timeout: 10_000,
    });

    // Read version for logging
    let version = 'unknown';
    try {
      const pkgJson = await readFile(path.join(cacheDir, 'package.json'), 'utf-8');
      const pkgParsed: unknown = JSON.parse(pkgJson);
      if (pkgParsed && typeof pkgParsed === 'object') {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- guarded above
        version = String((pkgParsed as Record<string, unknown>)['version'] ?? 'unknown');
      }
    } catch {
      // Non-fatal
    }

    process.stderr.write(`[admin] Cached admin agent v${version} at ${cacheDir}\n`);
    return cacheDir;
  } finally {
    // Cleanup temp directory
    await rm(tmpDir, {recursive: true, force: true}).catch(() => {});
  }
}

/**
 * Update the cached admin agent to the latest version from the registry.
 */
export async function updateAdminAgent(registryUrl?: string): Promise<string> {
  return fetchAdminAgent(registryUrl);
}

/**
 * Ensure the admin agent is available. Fetches from registry if not cached.
 */
export async function ensureAdminAgent(repoPath?: string, registryUrl?: string): Promise<string> {
  const existing = await resolveAdminAgent(repoPath);
  if (existing) return existing;
  return fetchAdminAgent(registryUrl);
}

/**
 * Get admin agent version from the cached copy.
 */
export async function getAdminAgentVersion(agentDir: string): Promise<string | null> {
  try {
    const pkgJson = await readFile(path.join(agentDir, 'package.json'), 'utf-8');
    const parsed: unknown = JSON.parse(pkgJson);
    if (parsed && typeof parsed === 'object') {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- guarded above
      return String((parsed as Record<string, unknown>)['version'] ?? null);
    }
    return null;
  } catch {
    return null;
  }
}

// --- Helpers ---

async function dirHasContent(dirPath: string): Promise<boolean> {
  try {
    const s = await stat(dirPath);
    if (!s.isDirectory()) return false;
    const entries = await readdir(dirPath);
    return entries.length > 0;
  } catch {
    return false;
  }
}
