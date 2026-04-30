/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

/**
 * Read `package.json#amodal.permissions` for an agent package and
 * normalize it into a `ToolPermission[]` ready for runtime gating.
 *
 * Default-deny: a package that does not declare any permissions gets an
 * empty array, and any tool inside it that reaches for a privileged
 * `ctx.*` capability throws `PermissionError` at the boundary.
 *
 * Tools authored inside the user's own agent repo (i.e. not under any
 * package) bypass the loader and run with full local-trust permissions
 * — the user wrote the handler, sandboxing them against their own repo
 * is not the threat model.
 */

import {readFile} from 'node:fs/promises';
import * as path from 'node:path';

import type {ToolPermission} from './context.js';

const VALID_PERMISSIONS = new Set<string>([
  'fs.read',
  'fs.write',
  'db.read',
  'db.write',
  'net.fetch',
]);

function isToolPermission(value: string): value is ToolPermission {
  return VALID_PERMISSIONS.has(value);
}

/**
 * Result of reading a package's permission declaration. Carries the
 * package name alongside the permissions so `PermissionError` can name
 * the offending package without a separate lookup.
 */
export interface PackagePermissions {
  packageName: string;
  permissions: ToolPermission[];
}

/**
 * Load the permission declaration for an installed package.
 *
 * Reads `${pkgDir}/package.json` and returns the `amodal.permissions`
 * array (filtered to known permission tiers). Missing or malformed
 * fields collapse to an empty permissions array so the package gets
 * default-deny behavior — the runtime never crashes because someone
 * forgot to declare permissions, it just refuses the privileged calls.
 *
 * Unknown permission strings are silently dropped (logged once at load
 * time by the caller) rather than throwing — adding a new permission
 * tier to the SDK shouldn't require simultaneous updates to every
 * pinned package version.
 */
export async function loadPackagePermissions(pkgDir: string): Promise<PackagePermissions> {
  const pkgJsonPath = path.join(pkgDir, 'package.json');
  let raw: string;
  try {
    raw = await readFile(pkgJsonPath, 'utf-8');
  } catch {
    return {packageName: path.basename(pkgDir), permissions: []};
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {packageName: path.basename(pkgDir), permissions: []};
  }

  if (typeof parsed !== 'object' || parsed === null) {
    return {packageName: path.basename(pkgDir), permissions: []};
  }

  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- parsing external JSON
  const pkg = parsed as Record<string, unknown>;
  const nameRaw = pkg['name'];
  const packageName = typeof nameRaw === 'string' ? nameRaw : path.basename(pkgDir);

  const amodalRaw = pkg['amodal'];
  if (typeof amodalRaw !== 'object' || amodalRaw === null) {
    return {packageName, permissions: []};
  }
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- parsing external JSON
  const amodal = amodalRaw as Record<string, unknown>;
  const declaredRaw = amodal['permissions'];
  if (!Array.isArray(declaredRaw)) {
    return {packageName, permissions: []};
  }

  const permissions: ToolPermission[] = [];
  for (const entry of declaredRaw) {
    if (typeof entry !== 'string') continue;
    const candidate = isToolPermission(entry) ? entry : undefined;
    if (candidate) permissions.push(candidate);
  }
  return {packageName, permissions};
}

/**
 * Symbolic constant for tools authored inside the user's own agent
 * repo. These tools are trusted with the full SDK surface — sandboxing
 * the user against their own code is not a useful threat model.
 */
export const LOCAL_REPO_PACKAGE: PackagePermissions = {
  packageName: '<local-repo>',
  permissions: ['fs.read', 'fs.write', 'db.read', 'db.write', 'net.fetch'],
};
