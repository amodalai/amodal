/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

/**
 * GET /api/package-updates — checks every entry in `amodal.json#packages`
 * for a newer published npm version and returns the diff. Cached in-memory
 * for 1 day so refreshing the home screen doesn't hammer the registry.
 *
 * POST /api/package-updates/install — runs `npm install <pkg>@latest` in
 * the repo root, then invalidates the cache so the next GET reflects the
 * new state.
 */

import express, {type Router, type Request, type Response} from 'express';
import {execFile} from 'node:child_process';
import {readFileSync, existsSync} from 'node:fs';
import {promisify} from 'node:util';
import * as path from 'node:path';
import type {Logger} from '../../logger.js';

const execFileAsync = promisify(execFile);

const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 1 day
const NPM_VIEW_TIMEOUT_MS = 10_000;
const NPM_INSTALL_TIMEOUT_MS = 120_000;
const PACKAGE_NAME_REGEX = /^(?:@[a-z0-9-]+\/)?[a-z0-9][a-z0-9._-]*$/;

/**
 * Resolve a path beneath `<repoPath>/node_modules` and verify the
 * result stays inside that base. Returns null on traversal attempts
 * (symlinks, double-resolved paths, etc.). The regex above already
 * blocks `/` outside the scope segment, but CodeQL flags any flow
 * from user input into a path expression — this is the belt and
 * suspenders.
 */
function safeNodeModulesPath(repoPath: string, name: string, ...rest: string[]): string | null {
  const base = path.resolve(repoPath, 'node_modules');
  const candidate = path.resolve(base, name, ...rest);
  if (candidate !== base && !candidate.startsWith(base + path.sep)) return null;
  return candidate;
}

export interface PackageUpdate {
  /** Package name, e.g. "@amodalai/connection-slack". */
  name: string;
  /** Currently installed version (from node_modules/<pkg>/package.json). */
  installed: string | null;
  /** Latest version published to npm. Null if the registry call failed. */
  latest: string | null;
  /** True when latest > installed (string compare on semver-like values). */
  hasUpdate: boolean;
}

interface UpdatesPayload {
  updates: PackageUpdate[];
  /** Epoch ms when this snapshot was taken. */
  checkedAt: number;
}

interface RouterDeps {
  /** Repo root used to resolve `amodal.json` and `node_modules/<pkg>`. */
  repoPath: string;
  logger: Logger;
}

export function createPackageUpdatesRouter(deps: RouterDeps): Router {
  const router = express.Router();
  const cache: {payload: UpdatesPayload | null} = {payload: null};

  router.get('/api/package-updates', (_req: Request, res: Response) => {
    void (async () => {
      try {
        const fresh = cache.payload && Date.now() - cache.payload.checkedAt < CACHE_TTL_MS;
        if (!fresh) {
          cache.payload = await refreshUpdates(deps);
        }
        res.json(cache.payload);
      } catch (err) {
        deps.logger.warn('package_updates_failed', {error: err instanceof Error ? err.message : String(err)});
        res.status(500).json({error: 'package_updates_failed'});
      }
    })();
  });

  // Read the installed card.json for a single package — drives the
  // "See what changed" page so it can show the user what they have today
  // before they hit Update.
  router.get('/api/package-card', (req: Request, res: Response) => {
    void (async () => {
      const name = typeof req.query['name'] === 'string' ? req.query['name'] : '';
      if (!PACKAGE_NAME_REGEX.test(name)) {
        res.status(400).json({error: 'invalid_package_name'});
        return;
      }
      const cardPath = safeNodeModulesPath(deps.repoPath, name, 'card', 'card.json');
      if (cardPath === null || !existsSync(cardPath)) {
        res.status(404).json({error: 'card_not_found'});
        return;
      }
      try {
        const raw = readFileSync(cardPath, 'utf-8');
        res.type('application/json').send(raw);
      } catch (err) {
        deps.logger.warn('package_card_read_failed', {name, error: err instanceof Error ? err.message : String(err)});
        res.status(500).json({error: 'card_read_failed'});
      }
    })();
  });

  router.post('/api/package-updates/install', express.json({limit: '8kb'}), (req: Request, res: Response) => {
    void (async () => {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- parsing JSON body at module boundary
      const body = req.body as {name?: unknown};
      const name = body.name;
      if (typeof name !== 'string' || !PACKAGE_NAME_REGEX.test(name)) {
        res.status(400).json({error: 'invalid_package_name'});
        return;
      }

      try {
        await execFileAsync('npm', ['install', `${name}@latest`], {
          cwd: deps.repoPath,
          timeout: NPM_INSTALL_TIMEOUT_MS,
        });
        cache.payload = null; // force refresh on next GET
        res.json({ok: true, name});
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        deps.logger.warn('package_install_failed', {name, error: message});
        res.status(500).json({error: 'install_failed', message});
      }
    })();
  });

  return router;
}

// ---------------------------------------------------------------------------
// Refresh logic
// ---------------------------------------------------------------------------

async function refreshUpdates(deps: RouterDeps): Promise<UpdatesPayload> {
  const {repoPath, logger} = deps;
  const installedNames = readAmodalPackages(repoPath);
  if (installedNames.length === 0) {
    return {updates: [], checkedAt: Date.now()};
  }

  const updates = await Promise.all(
    installedNames.map(async (name): Promise<PackageUpdate> => {
      const installed = readInstalledVersion(repoPath, name);
      const latest = await fetchLatestVersion(name, logger);
      const hasUpdate = installed !== null && latest !== null && compareVersions(installed, latest) < 0;
      return {name, installed, latest, hasUpdate};
    }),
  );

  return {updates, checkedAt: Date.now()};
}

function readAmodalPackages(repoPath: string): string[] {
  const configPath = path.join(repoPath, 'amodal.json');
  if (!existsSync(configPath)) return [];
  try {
    const raw: unknown = JSON.parse(readFileSync(configPath, 'utf-8'));
    if (typeof raw !== 'object' || raw === null) return [];
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- guarded above
    const packagesRaw = (raw as Record<string, unknown>)['packages'];
    if (!Array.isArray(packagesRaw)) return [];
    return packagesRaw.filter(
      (n): n is string => typeof n === 'string' && PACKAGE_NAME_REGEX.test(n),
    );
  } catch {
    return [];
  }
}

function readInstalledVersion(repoPath: string, name: string): string | null {
  const pkgPath = safeNodeModulesPath(repoPath, name, 'package.json');
  if (pkgPath === null || !existsSync(pkgPath)) return null;
  try {
    const raw: unknown = JSON.parse(readFileSync(pkgPath, 'utf-8'));
    if (typeof raw !== 'object' || raw === null) return null;
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- guarded above
    const version = (raw as Record<string, unknown>)['version'];
    return typeof version === 'string' ? version : null;
  } catch {
    return null;
  }
}

async function fetchLatestVersion(name: string, logger: Logger): Promise<string | null> {
  try {
    const {stdout} = await execFileAsync('npm', ['view', name, 'version'], {
      timeout: NPM_VIEW_TIMEOUT_MS,
    });
    const version = stdout.trim();
    return version === '' ? null : version;
  } catch (err) {
    logger.debug('npm_view_failed', {name, error: err instanceof Error ? err.message : String(err)});
    return null;
  }
}

/**
 * Loose semver compare: split on dots, compare numerically when possible.
 * Returns negative when a < b, positive when a > b, 0 when equal. Tags like
 * "1.2.0-beta.1" sort by lexical order on the tail — good enough for "is
 * there an update available?".
 */
export function compareVersions(a: string, b: string): number {
  const partsA = a.split('.');
  const partsB = b.split('.');
  const len = Math.max(partsA.length, partsB.length);
  for (let i = 0; i < len; i++) {
    const av = partsA[i] ?? '0';
    const bv = partsB[i] ?? '0';
    const an = Number.parseInt(av, 10);
    const bn = Number.parseInt(bv, 10);
    if (!Number.isNaN(an) && !Number.isNaN(bn) && an !== bn) return an - bn;
    if (av !== bv) return av < bv ? -1 : 1;
  }
  return 0;
}

// Re-export for unit test access without going through the router.
export {readAmodalPackages, readInstalledVersion};
