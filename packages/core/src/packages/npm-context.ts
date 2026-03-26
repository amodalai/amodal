/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import {execFile} from 'node:child_process';
import {mkdir, readlink, stat, symlink, unlink, writeFile} from 'node:fs/promises';
import * as path from 'node:path';
import {promisify} from 'node:util';

import {PackageError} from './package-error.js';
import {
  makePackageRef,
  parsePackageKey,
  toSymlinkName,
} from './package-types.js';
import type {LockFile, PackageRef} from './package-types.js';

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
  for (const [, entry] of Object.entries(lockFile.packages)) {
    dependencies[entry.npm] = entry.version;
  }
  return {
    name: 'amodal-packages',
    private: true,
    dependencies,
  };
}

/**
 * Create or repair a symlink from the clean path to the npm node_modules path.
 */
export async function ensureSymlink(
  paths: NpmContextPaths,
  ref: PackageRef,
): Promise<string> {
  const symlinkDir = path.join(paths.root, toSymlinkName(ref.type, ref.name));
  const target = path.join(paths.nodeModules, ref.npmName);

  // Verify target exists
  try {
    await stat(target);
  } catch {
    throw new PackageError('SYMLINK_FAILED', `Package not installed: ${ref.npmName}`);
  }

  // Remove existing symlink if broken or wrong target
  try {
    const existingTarget = await readlink(symlinkDir);
    if (existingTarget === target) return symlinkDir;
    await unlink(symlinkDir);
  } catch (err) {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      // Try to remove it anyway
      try {
        await unlink(symlinkDir);
      } catch {
        // Ignore cleanup errors
      }
    }
  }

  try {
    await symlink(target, symlinkDir, 'dir');
  } catch (err) {
    throw new PackageError('SYMLINK_FAILED', `Failed to create symlink: ${symlinkDir}`, err);
  }

  return symlinkDir;
}

/**
 * Create symlinks for all packages in a lock file.
 */
export async function ensureAllSymlinks(
  paths: NpmContextPaths,
  lockFile: LockFile,
): Promise<void> {
  const tasks = Object.keys(lockFile.packages).map((key) => {
    const parsed = parsePackageKey(key);
    const ref = makePackageRef(parsed.type, parsed.name);
    return ensureSymlink(paths, ref);
  });
  await Promise.all(tasks);
}

/**
 * Get the resolved package directory for an installed package.
 * Returns null if the package is not installed or the symlink is broken.
 */
export async function getPackageDir(
  repoPath: string,
  ref: PackageRef,
): Promise<string | null> {
  const paths = getNpmContextPaths(repoPath);
  const symlinkDir = path.join(paths.root, toSymlinkName(ref.type, ref.name));

  try {
    const targetStat = await stat(symlinkDir);
    if (targetStat.isDirectory()) return symlinkDir;
    return null;
  } catch {
    return null;
  }
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
