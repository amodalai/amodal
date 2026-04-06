/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {existsSync, readFileSync, writeFileSync} from 'node:fs';
import * as path from 'node:path';

import {PackageError} from './package-error.js';

const execFileAsync = promisify(execFile);

type PackageManager = 'pnpm' | 'npm' | 'yarn';

export function detectPackageManager(repoPath: string): PackageManager {
  if (existsSync(path.join(repoPath, 'pnpm-lock.yaml'))) return 'pnpm';
  if (existsSync(path.join(repoPath, 'yarn.lock'))) return 'yarn';
  if (existsSync(path.join(repoPath, 'package-lock.json'))) return 'npm';
  return 'npm'; // default
}

export async function pmAdd(repoPath: string, npmName: string): Promise<void> {
  const pm = detectPackageManager(repoPath);
  const cmd = pm === 'yarn' ? 'yarn' : pm;
  const args = pm === 'yarn' ? ['add', npmName] : [pm === 'pnpm' ? 'add' : 'install', npmName];
  try {
    await execFileAsync(cmd, args, {cwd: repoPath});
  } catch (err) {
    throw new PackageError('NPM_INSTALL_FAILED', `Failed to add ${npmName}`, err);
  }
}

export async function pmRemove(repoPath: string, npmName: string): Promise<void> {
  const pm = detectPackageManager(repoPath);
  const cmd = pm === 'yarn' ? 'yarn' : pm;
  const args = pm === 'yarn' ? ['remove', npmName] : [pm === 'pnpm' ? 'remove' : 'uninstall', npmName];
  try {
    await execFileAsync(cmd, args, {cwd: repoPath});
  } catch (err) {
    throw new PackageError('NPM_INSTALL_FAILED', `Failed to remove ${npmName}`, err);
  }
}

export async function pmInstall(repoPath: string): Promise<void> {
  const pm = detectPackageManager(repoPath);
  try {
    await execFileAsync(pm, ['install'], {cwd: repoPath});
  } catch (err) {
    throw new PackageError('NPM_INSTALL_FAILED', 'Failed to install packages', err);
  }
}

export function ensurePackageJson(repoPath: string, projectName: string): void {
  const pkgPath = path.join(repoPath, 'package.json');
  if (existsSync(pkgPath)) return;
  const pkg = {
    name: projectName,
    private: true,
    type: 'module',
  };
  writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
}

/**
 * Add a package name to the `packages` array in amodal.json.
 * Creates the array if it doesn't exist. No-op if already present.
 */
export function addAmodalPackage(repoPath: string, npmName: string): void {
  const configPath = path.join(repoPath, 'amodal.json');
  const raw = readFileSync(configPath, 'utf-8');
  const parsed: unknown = JSON.parse(raw);
  if (!parsed || typeof parsed !== 'object') return;
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- validated object above
  const config = parsed as Record<string, unknown>;
  const packages = Array.isArray(config['packages'])
    ? config['packages'].filter((p): p is string => typeof p === 'string')
    : [];
  if (packages.includes(npmName)) return;
  packages.push(npmName);
  config['packages'] = packages;
  writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n');
}

/**
 * Remove a package name from the `packages` array in amodal.json.
 * Removes the field entirely if the array becomes empty.
 */
export function removeAmodalPackage(repoPath: string, npmName: string): void {
  const configPath = path.join(repoPath, 'amodal.json');
  const raw = readFileSync(configPath, 'utf-8');
  const parsed: unknown = JSON.parse(raw);
  if (!parsed || typeof parsed !== 'object') return;
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- validated object above
  const config = parsed as Record<string, unknown>;
  if (!Array.isArray(config['packages'])) return;
  const packages = config['packages'].filter((p): p is string => typeof p === 'string' && p !== npmName);
  if (packages.length === 0) {
    delete config['packages'];
  } else {
    config['packages'] = packages;
  }
  writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n');
}
