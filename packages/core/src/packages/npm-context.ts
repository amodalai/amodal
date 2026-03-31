/**
 * @license
 * Copyright 2025 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import {execFile} from 'node:child_process';
import {mkdir, readdir, stat, writeFile} from 'node:fs/promises';
import * as path from 'node:path';
import {promisify} from 'node:util';

import {PackageError} from './package-error.js';
import type {LockFile} from './package-types.js';

const execFileAsync = promisify(execFile);

const DEFAULT_REGISTRY_URL = 'https://registry.amodalai.com';
const DEFAULT_TIMEOUT = 30_000;

/**
 * Paths for the hidden npm context.
 */
export interface NpmContextPaths {
  root: string;
  npmDir: string;
  npmrc: string;
  packageJson: string;
  nodeModules: string;
}

/**
 * Get the standard paths for the hidden npm context.
 */
export function getNpmContextPaths(repoPath: string): NpmContextPaths {
  const root = path.join(repoPath, 'amodal_packages');
  const npmDir = path.join(root, '.npm');
  return {
    root,
    npmDir,
    npmrc: path.join(npmDir, '.npmrc'),
    packageJson: path.join(npmDir, 'package.json'),
    nodeModules: path.join(npmDir, 'node_modules'),
  };
}

/**
 * Ensure the hidden npm context exists. Idempotent.
 */
export async function ensureNpmContext(
  repoPath: string,
  registryUrl?: string,
): Promise<NpmContextPaths> {
  const paths = getNpmContextPaths(repoPath);

  await mkdir(paths.npmDir, {recursive: true});

  // Write .npmrc
  const registry = registryUrl ?? process.env['AMODAL_REGISTRY'] ?? DEFAULT_REGISTRY_URL;
  await writeFile(paths.npmrc, `registry=${registry}\n`, 'utf-8');

  // Write minimal package.json if it doesn't exist
  try {
    await stat(paths.packageJson);
  } catch {
    await writeFile(
      paths.packageJson,
      JSON.stringify({name: 'amodal-packages', private: true, dependencies: {}}, null, 2) + '\n',
      'utf-8',
    );
  }

  return paths;
}

/**
 * Run `npm install` for a specific package.
 */
export async function npmInstall(
  paths: NpmContextPaths,
  npmName: string,
  version?: string,
  timeout?: number,
): Promise<{version: string; integrity: string}> {
  const pkg = version ? `${npmName}@${version}` : npmName;
  try {
    const {stdout} = await execFileAsync(
      'npm',
      ['install', '--save', '--json', '--fetch-timeout=10000', pkg],
      {
        cwd: paths.npmDir,
        timeout: timeout ?? DEFAULT_TIMEOUT,
      },
    );

    // Parse npm output to get resolved version and integrity
    let parsed: unknown;
    try {
      parsed = JSON.parse(stdout);
    } catch {
      // Fallback: read from package-lock.json or package.json
      return await readInstalledVersion(paths, npmName);
    }

    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
    const result = parsed as Record<string, unknown>;
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
    const added = result['added'] as Array<Record<string, unknown>> | undefined;
    if (added && added.length > 0) {
      const entry = added[0];
      return {
        version: String(entry['version'] ?? ''),
        integrity: String(entry['integrity'] ?? ''),
      };
    }

    return await readInstalledVersion(paths, npmName);
  } catch (err) {
    throw new PackageError('NPM_INSTALL_FAILED', `Failed to install ${pkg}`, err);
  }
}

/**
 * Run `npm install` to restore all packages from package.json.
 */
export async function npmInstallAll(
  paths: NpmContextPaths,
  timeout?: number,
): Promise<void> {
  try {
    await execFileAsync('npm', ['install'], {
      cwd: paths.npmDir,
      timeout: timeout ?? DEFAULT_TIMEOUT,
    });
  } catch (err) {
    throw new PackageError('NPM_INSTALL_FAILED', 'Failed to install packages', err);
  }
}

/**
 * Run `npm uninstall` for a specific package.
 */
export async function npmUninstall(
  paths: NpmContextPaths,
  npmName: string,
  timeout?: number,
): Promise<void> {
  try {
    await execFileAsync('npm', ['uninstall', npmName], {
      cwd: paths.npmDir,
      timeout: timeout ?? DEFAULT_TIMEOUT,
    });
  } catch (err) {
    throw new PackageError('NPM_INSTALL_FAILED', `Failed to uninstall ${npmName}`, err);
  }
}

/**
 * Generate package.json dependencies from a lock file.
 */
export function generatePackageJson(lockFile: LockFile): Record<string, unknown> {
  const dependencies: Record<string, string> = {};
  for (const [npmName, entry] of Object.entries(lockFile.packages)) {
    dependencies[npmName] = entry.version;
  }
  return {
    name: 'amodal-packages',
    private: true,
    dependencies,
  };
}

/**
 * Read version info from an installed package's package.json.
 * Falls back to package-lock.json for integrity if _integrity is missing
 * (common with local registries like Verdaccio).
 */
async function readInstalledVersion(
  paths: NpmContextPaths,
  npmName: string,
): Promise<{version: string; integrity: string}> {
  const {readFile: rf} = await import('node:fs/promises');

  const pkgJsonPath = path.join(paths.nodeModules, npmName, 'package.json');
  let version = '';
  let integrity = '';

  try {
    const raw = await rf(pkgJsonPath, 'utf-8');
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
    const pkg = JSON.parse(raw) as Record<string, unknown>;
    version = String(pkg['version'] ?? '');
    integrity = String(pkg['_integrity'] ?? '');
  } catch {
    // Package not readable
  }

  // If _integrity is missing, try package-lock.json
  if (!integrity) {
    try {
      const lockPath = path.join(paths.npmDir, 'package-lock.json');
      const lockRaw = await rf(lockPath, 'utf-8');
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      const lock = JSON.parse(lockRaw) as Record<string, unknown>;
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      const packages = (lock['packages'] ?? {}) as Record<string, Record<string, unknown>>;
      const entry = packages[`node_modules/${npmName}`];
      if (entry) {
        integrity = String(entry['integrity'] ?? '');
        if (!version) version = String(entry['version'] ?? '');
      }
    } catch {
      // No lock file or parse failure — use what we have
    }
  }

  return {version, integrity};
}

/**
 * Discovered package from node_modules scan.
 */
export interface DiscoveredPackage {
  npmName: string;
  version: string;
  integrity: string;
  packageDir: string;
}

/**
 * Scan node_modules/@amodalai/* to discover all installed amodal packages.
 * Used after npm install to rebuild the lock file from what's actually installed.
 */
export async function discoverInstalledPackages(
  paths: NpmContextPaths,
): Promise<DiscoveredPackage[]> {
  const scopeDir = path.join(paths.nodeModules, '@amodalai');

  let entries: string[];
  try {
    entries = await readdir(scopeDir);
  } catch {
    return [];
  }

  const results: DiscoveredPackage[] = [];

  for (const entry of entries) {
    const packageDir = path.join(scopeDir, entry);
    const npmName = `@amodalai/${entry}`;

    try {
      const s = await stat(packageDir);
      if (!s.isDirectory()) continue;
    } catch {
      continue;
    }

    const {version, integrity} = await readInstalledVersion(paths, npmName);
    if (!version) continue;

    results.push({npmName, version, integrity, packageDir});
  }

  return results;
}
