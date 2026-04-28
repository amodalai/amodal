/**
 * @license
 * Copyright 2025 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import {execFile} from 'node:child_process';
import {mkdir, readdir, readFile, rename, rm, stat} from 'node:fs/promises';
import * as path from 'node:path';
import {homedir} from 'node:os';
import {promisify} from 'node:util';
const execFileAsync = promisify(execFile);

const ADMIN_AGENT_NPM = '@amodalai/agent-admin';
const DEFAULT_REGISTRY = 'https://registry.npmjs.org';
const CACHE_DIR_NAME = 'admin-agent';
const FETCH_TIMEOUT = 30_000;
const REGISTRY_CHECK_TIMEOUT = 3_000;

export class AdminAgentFetchError extends Error {
  override readonly name = 'AdminAgentFetchError';
  constructor(message: string, readonly packageSpec: string, options?: ErrorOptions) {
    super(message, options);
  }
}

// ---------------------------------------------------------------------------
// Cache directory
// ---------------------------------------------------------------------------

/**
 * Get the cache directory for a specific admin agent version slot.
 * Defaults to the "latest" slot when no version is provided.
 */
export function getAdminCacheDir(version?: string): string {
  const slot = version ?? 'latest';
  return path.join(homedir(), '.amodal', CACHE_DIR_NAME, slot);
}

// ---------------------------------------------------------------------------
// Config reading
// ---------------------------------------------------------------------------

export interface AdminAgentConfig {
  pathOverride?: string;
  pinnedVersion?: string;
}

/**
 * Read admin agent configuration from amodal.json.
 * Returns the path override and/or pinned version if configured.
 */
export async function getAdminAgentConfig(repoPath?: string): Promise<AdminAgentConfig> {
  if (!repoPath) return {};
  try {
    const configPath = path.join(repoPath, 'amodal.json');
    const configRaw = await readFile(configPath, 'utf-8');
    const parsed: unknown = JSON.parse(configRaw);
    if (!parsed || typeof parsed !== 'object') return {};
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- guarded above
    const record = parsed as Record<string, unknown>;
    const result: AdminAgentConfig = {};
    if (typeof record['adminAgent'] === 'string') {
      result.pathOverride = record['adminAgent'];
    }
    if (typeof record['adminAgentVersion'] === 'string') {
      result.pinnedVersion = record['adminAgentVersion'];
    }
    return result;
  } catch {
    return {};
  }
}

// ---------------------------------------------------------------------------
// Resolution
// ---------------------------------------------------------------------------

/**
 * Resolve the admin agent directory. Checks in order:
 * 1. adminAgent path from amodal.json (explicit override)
 * 2. Version-slotted global cache at ~/.amodal/admin-agent/<version>/
 *
 * Returns null if not found (caller should fetch).
 */
export async function resolveAdminAgent(repoPath?: string): Promise<string | null> {
  const config = await getAdminAgentConfig(repoPath);

  // 1. Check amodal.json path override
  if (config.pathOverride && repoPath) {
    const resolved = path.resolve(repoPath, config.pathOverride);
    if (await dirHasContent(resolved)) {
      return resolved;
    }
  }

  // 2. Check version-slotted cache
  const cacheDir = getAdminCacheDir(config.pinnedVersion);
  if (await dirHasContent(cacheDir)) {
    return cacheDir;
  }

  // 3. Migration: move old flat cache into latest/ slot
  if (!config.pinnedVersion) {
    const migrated = await migrateOldCache();
    if (migrated) return migrated;
  }

  return null;
}

// ---------------------------------------------------------------------------
// Fetching
// ---------------------------------------------------------------------------

export interface FetchOptions {
  version?: string;
  registryUrl?: string;
}

/**
 * Fetch the admin agent from the registry and cache it.
 * When `version` is provided, fetches that specific version.
 * Returns the cache directory path.
 */
export async function fetchAdminAgent(options?: FetchOptions): Promise<string> {
  const version = options?.version;
  const registry = options?.registryUrl ?? DEFAULT_REGISTRY;
  const cacheDir = getAdminCacheDir(version);

  const tmpDir = path.join(homedir(), '.amodal', '.tmp-admin-fetch');
  await mkdir(tmpDir, {recursive: true});

  try {
    const packageSpec = version ? `${ADMIN_AGENT_NPM}@${version}` : ADMIN_AGENT_NPM;
    const {stdout} = await execFileAsync(
      'npm',
      ['pack', packageSpec, '--registry', registry, '--pack-destination', tmpDir, '--json'],
      {cwd: tmpDir, timeout: FETCH_TIMEOUT},
    );

    let tarballName: string;
    try {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- npm pack JSON output
      const parsed = JSON.parse(stdout) as Array<{filename: string}>;
      tarballName = parsed[0]?.filename ?? '';
    } catch {
      const files = await readdir(tmpDir);
      tarballName = files.find((f) => f.endsWith('.tgz')) ?? '';
    }

    if (!tarballName) {
      throw new AdminAgentFetchError(
        `npm pack returned no tarball for ${packageSpec}`,
        packageSpec,
      );
    }

    const tarballPath = path.join(tmpDir, tarballName);

    // Clear only this version slot
    await rm(cacheDir, {recursive: true, force: true});
    await mkdir(cacheDir, {recursive: true});

    await execFileAsync('tar', ['xzf', tarballPath, '-C', cacheDir, '--strip-components=1'], {
      timeout: 10_000,
    });

    return cacheDir;
  } finally {
    await rm(tmpDir, {recursive: true, force: true}).catch(() => {});
  }
}

/**
 * Update the cached admin agent. Re-fetches the version slot
 * appropriate for the current project config.
 */
export async function updateAdminAgent(options?: FetchOptions): Promise<string> {
  return fetchAdminAgent(options);
}

/**
 * Ensure the admin agent is available. Fetches from registry if not cached.
 */
export async function ensureAdminAgent(repoPath?: string, registryUrl?: string): Promise<string> {
  const config = await getAdminAgentConfig(repoPath);

  // Path override — resolve directly, no cache involved
  if (config.pathOverride && repoPath) {
    const resolved = path.resolve(repoPath, config.pathOverride);
    if (await dirHasContent(resolved)) {
      return resolved;
    }
  }

  // Check cache (version-slotted)
  const existing = await resolveAdminAgent(repoPath);
  if (existing) return existing;

  // Fetch from registry
  return fetchAdminAgent({version: config.pinnedVersion, registryUrl});
}

// ---------------------------------------------------------------------------
// Version helpers
// ---------------------------------------------------------------------------

/**
 * Get admin agent version from a cached copy's package.json.
 */
export async function getAdminAgentVersion(agentDir: string): Promise<string | null> {
  try {
    const pkgJson = await readFile(path.join(agentDir, 'package.json'), 'utf-8');
    const parsed: unknown = JSON.parse(pkgJson);
    if (parsed && typeof parsed === 'object') {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- guarded above
      const version = (parsed as Record<string, unknown>)['version'];
      return typeof version === 'string' ? version : null;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Check the npm registry for the latest published version.
 * Returns the version string, or null on any failure (timeout, network, parse).
 */
export async function checkRegistryVersion(registryUrl?: string): Promise<string | null> {
  const registry = registryUrl ?? DEFAULT_REGISTRY;
  const encodedPkg = ADMIN_AGENT_NPM.replaceAll('/', '%2f');
  const url = `${registry}/${encodedPkg}/latest`;

  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(REGISTRY_CHECK_TIMEOUT),
      headers: {accept: 'application/json'},
    });
    if (!res.ok) return null;
    const body: unknown = await res.json();
    if (body && typeof body === 'object') {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- npm registry JSON
      const version = (body as Record<string, unknown>)['version'];
      return typeof version === 'string' ? version : null;
    }
    return null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Migration
// ---------------------------------------------------------------------------

/**
 * One-time migration: if the old flat cache layout is detected
 * (~/.amodal/admin-agent/package.json exists at root level),
 * move the contents into the latest/ slot.
 *
 * If the structure is unrecognizable (no package.json, not a valid
 * admin agent), nuke the directory so a fresh fetch starts clean.
 */
async function migrateOldCache(): Promise<string | null> {
  const baseDir = path.join(homedir(), '.amodal', CACHE_DIR_NAME);
  const latestDir = path.join(baseDir, 'latest');

  let entries: string[];
  try {
    entries = await readdir(baseDir);
  } catch {
    return null; // Base dir doesn't exist
  }

  // If latest/ already exists, no migration needed
  if (entries.includes('latest')) return null;

  // Nothing there
  if (entries.length === 0) return null;

  // Old flat layout: package.json at root level
  if (entries.includes('package.json')) {
    try {
      const tmpMigrate = path.join(baseDir, '.migrating');
      await rm(tmpMigrate, {recursive: true, force: true});
      await mkdir(tmpMigrate, {recursive: true});

      for (const entry of entries) {
        if (entry === '.migrating') continue;
        await rename(path.join(baseDir, entry), path.join(tmpMigrate, entry));
      }

      await rename(tmpMigrate, latestDir);
      return latestDir;
    } catch {
      // Migration failed — nuke and let caller re-fetch
      await rm(baseDir, {recursive: true, force: true}).catch(() => {});
      return null;
    }
  }

  // Unrecognizable structure — nuke it
  await rm(baseDir, {recursive: true, force: true}).catch(() => {});
  return null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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
