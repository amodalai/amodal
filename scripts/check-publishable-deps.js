#!/usr/bin/env node
/**
 * @license
 * Copyright 2025 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 *
 * Guard against broken releases by enforcing a single invariant:
 *
 *   No public (non-private) workspace package may depend on a private
 *   workspace package.
 *
 * Why: when a public package declares `"@amodalai/foo": "workspace:*"` but
 * `@amodalai/foo` has `"private": true`, `pnpm publish` happily rewrites the
 * spec to the private package's version and pushes the tarball to npm — but
 * the private package itself is never published. End users hit
 * `ERR_PNPM_FETCH_404` the moment they try to install it. We hit exactly this
 * bug in @amodalai/amodal@0.3.0 with @amodalai/db.
 *
 * Runs as part of `pnpm lint` / CI. Zero dependencies.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const packagesDir = join(repoRoot, 'packages');

/** @returns {Array<{ dir: string, json: any }>} */
function loadWorkspacePackages() {
  const entries = readdirSync(packagesDir);
  const packages = [];
  for (const name of entries) {
    const dir = join(packagesDir, name);
    if (!statSync(dir).isDirectory()) continue;
    const pkgPath = join(dir, 'package.json');
    try {
      const json = JSON.parse(readFileSync(pkgPath, 'utf8'));
      packages.push({ dir, json });
    } catch {
      // Not a package directory — skip.
    }
  }
  return packages;
}

function isPrivate(pkgJson) {
  return pkgJson.private === true;
}

/** @returns {string[]} all dep names across dependencies + peerDependencies */
function allRuntimeDeps(pkgJson) {
  return [
    ...Object.keys(pkgJson.dependencies || {}),
    ...Object.keys(pkgJson.peerDependencies || {}),
  ];
}

function main() {
  const packages = loadWorkspacePackages();
  const byName = new Map(packages.map((p) => [p.json.name, p]));

  /** @type {Array<{ publicPkg: string, privateDep: string }>} */
  const violations = [];

  for (const { json } of packages) {
    if (isPrivate(json)) continue;
    for (const depName of allRuntimeDeps(json)) {
      const dep = byName.get(depName);
      if (!dep) continue; // External (npm) dep — not our concern.
      if (isPrivate(dep.json)) {
        violations.push({ publicPkg: json.name, privateDep: depName });
      }
    }
  }

  if (violations.length === 0) {
    console.log(
      `check-publishable-deps: OK (${packages.length} workspace packages scanned)`,
    );
    return;
  }

  console.error('check-publishable-deps: FAIL');
  console.error('');
  console.error(
    'The following public (published) packages depend on private workspace packages.',
  );
  console.error(
    'Private packages are NOT published to npm, so installs of the public package',
  );
  console.error(
    'will fail with ERR_PNPM_FETCH_404 on the private dep. See @amodalai/amodal@0.3.0',
  );
  console.error('for a past incident.');
  console.error('');
  for (const v of violations) {
    console.error(`  ${v.publicPkg} (public)  ->  ${v.privateDep} (private)`);
  }
  console.error('');
  console.error('Fix options:');
  console.error(
    '  1. Make the dep publishable: remove `private: true`, add license/repository/',
  );
  console.error(
    '     homepage/bugs/files metadata, and add it to the `fixed` group in',
  );
  console.error('     .changeset/config.json so it versions in lockstep.');
  console.error(
    '  2. Or stop importing it from the published package (inline, move, or drop).',
  );
  process.exit(1);
}

main();
