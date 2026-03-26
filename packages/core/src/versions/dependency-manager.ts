/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import { execFile } from 'node:child_process';
import { writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import type { BundleDependencies } from './version-bundle-types.js';

const execFileAsync = promisify(execFile);

/** Maximum time (ms) for dependency installation commands. */
const INSTALL_TIMEOUT = 120_000;
/** Maximum time (ms) for `which` binary check. */
const WHICH_TIMEOUT = 5_000;

// ---------------------------------------------------------------------------
// Dependency diffing (pure)
// ---------------------------------------------------------------------------

export interface DependencyDiff {
  npm: {
    added: Record<string, string>;
    removed: string[];
    changed: Record<string, string>;
  };
  pip: {
    added: Record<string, string>;
    removed: string[];
    changed: Record<string, string>;
  };
  system: {
    added: string[];
    removed: string[];
  };
}

/**
 * Compute the difference between old and new dependencies.
 * Pure function — no side effects.
 */
export function diffDependencies(
  oldDeps: BundleDependencies,
  newDeps: BundleDependencies,
): DependencyDiff {
  return {
    npm: diffPackages(oldDeps.npm ?? {}, newDeps.npm ?? {}),
    pip: diffPackages(oldDeps.pip ?? {}, newDeps.pip ?? {}),
    system: diffArrays(oldDeps.system ?? [], newDeps.system ?? []),
  };
}

function diffPackages(
  oldPkgs: Record<string, string>,
  newPkgs: Record<string, string>,
): { added: Record<string, string>; removed: string[]; changed: Record<string, string> } {
  const added: Record<string, string> = {};
  const removed: string[] = [];
  const changed: Record<string, string> = {};

  for (const [name, version] of Object.entries(newPkgs)) {
    if (!(name in oldPkgs)) {
      added[name] = version;
    } else if (oldPkgs[name] !== version) {
      changed[name] = version;
    }
  }
  for (const name of Object.keys(oldPkgs)) {
    if (!(name in newPkgs)) {
      removed.push(name);
    }
  }

  return { added, removed, changed };
}

function diffArrays(
  oldArr: string[],
  newArr: string[],
): { added: string[]; removed: string[] } {
  const oldSet = new Set(oldArr);
  const newSet = new Set(newArr);
  return {
    added: newArr.filter((s) => !oldSet.has(s)),
    removed: oldArr.filter((s) => !newSet.has(s)),
  };
}

// ---------------------------------------------------------------------------
// npm dependency installation
// ---------------------------------------------------------------------------

/**
 * Install npm dependencies into a version directory.
 * Creates a package.json and runs `pnpm install --prod`.
 */
export async function installNpmDependencies(
  deps: Record<string, string>,
  versionDir: string,
): Promise<void> {
  if (Object.keys(deps).length === 0) return;

  const pkgJson = {
    name: 'version-bundle-deps',
    version: '0.0.0',
    private: true,
    dependencies: deps,
  };

  await mkdir(versionDir, { recursive: true });
  await writeFile(
    path.join(versionDir, 'package.json'),
    JSON.stringify(pkgJson, null, 2),
  );

  await execFileAsync('pnpm', ['install', '--prod'], {
    cwd: versionDir,
    timeout: INSTALL_TIMEOUT,
  });
}

// ---------------------------------------------------------------------------
// pip dependency installation
// ---------------------------------------------------------------------------

/**
 * Install pip dependencies into a version directory.
 * Uses `pip install --target <dir>/python_modules`.
 */
export async function installPipDependencies(
  deps: Record<string, string>,
  versionDir: string,
): Promise<void> {
  if (Object.keys(deps).length === 0) return;

  const targetDir = path.join(versionDir, 'python_modules');
  await mkdir(targetDir, { recursive: true });

  const packages = Object.entries(deps).map(
    ([name, version]) => `${name}==${version}`,
  );

  await execFileAsync(
    'pip',
    ['install', '--target', targetDir, ...packages],
    { cwd: versionDir, timeout: INSTALL_TIMEOUT },
  );
}

// ---------------------------------------------------------------------------
// System binary verification
// ---------------------------------------------------------------------------

/**
 * Verify that required system binaries are available.
 * Returns the list of missing binaries.
 */
export async function verifySystemBinaries(
  binaries: string[],
): Promise<{ missing: string[] }> {
  if (binaries.length === 0) return { missing: [] };

  const missing: string[] = [];
  for (const binary of binaries) {
    try {
      await execFileAsync('which', [binary], { timeout: WHICH_TIMEOUT });
    } catch {
      missing.push(binary);
    }
  }

  return { missing };
}

// ---------------------------------------------------------------------------
// Orchestrator
// ---------------------------------------------------------------------------

export interface DependencyInstallResult {
  npmInstalled: boolean;
  pipInstalled: boolean;
  missingBinaries: string[];
}

/**
 * Install all dependencies from a diff into a version directory.
 * Returns the installation result. Throws if system binaries are missing.
 */
export async function installDependencies(
  diff: DependencyDiff,
  versionDir: string,
): Promise<DependencyInstallResult> {
  // Merge added + changed into a single set to install
  const npmToInstall = { ...diff.npm.added, ...diff.npm.changed };
  const pipToInstall = { ...diff.pip.added, ...diff.pip.changed };

  // Install npm and pip in parallel
  const [, , systemResult] = await Promise.all([
    installNpmDependencies(npmToInstall, versionDir),
    installPipDependencies(pipToInstall, versionDir),
    verifySystemBinaries(diff.system.added),
  ]);

  return {
    npmInstalled: Object.keys(npmToInstall).length > 0,
    pipInstalled: Object.keys(pipToInstall).length > 0,
    missingBinaries: systemResult.missing,
  };
}
