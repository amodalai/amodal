/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import {Router} from 'express';
import type {Request, Response} from 'express';
import rateLimit from 'express-rate-limit';
import {readdir, readFile, writeFile, stat, mkdir} from 'node:fs/promises';
import path from 'node:path';
import {asyncHandler} from '../../routes/route-helpers.js';
import type {RoleProvider, RuntimeRole} from '../../role-provider.js';
import {defaultRoleProvider, hasRole} from '../../role-provider.js';
import {createLogger} from '../../logger.js';

const log = createLogger({component: 'files-router'});

/**
 * Directories an admin can read and write. Anything outside this allowlist
 * (like `connections/`, `tools/`, `evals/`, `amodal.json`) requires `ops`.
 *
 * The admin/ops split mirrors the persona model in the architecture doc:
 * - admin (Sally) edits *content* — skill prompts, knowledge docs, agent personality
 * - ops (developers) edit everything including infrastructure
 */
const ADMIN_ALLOWED_DIRS = ['skills', 'knowledge', 'agents'];

export interface FilesRouterOptions {
  repoPath: string;
  /**
   * RoleProvider for role-gated file access. Defaults to the everyone-is-ops
   * provider in `amodal dev`. In hosted contexts the cloud provider returns
   * the actual user role from the platform JWT.
   */
  roleProvider?: RoleProvider;
}

/**
 * Decide whether a role can access a given file path.
 *
 * Rules:
 *  - `ops` can read/write anything (subject to the existing repo-traversal check)
 *  - `admin` can read/write files inside ADMIN_ALLOWED_DIRS only
 *  - `user` cannot access files at all
 *
 * Returns null if allowed, or an error code if denied.
 */
function checkPathAccess(filePath: string, role: RuntimeRole): 'ok' | 'forbidden' {
  if (role === 'ops') return 'ok';
  if (role === 'user') return 'forbidden';
  // admin: must be inside an allowed top-level directory
  // path.normalize collapses '..' and '.' segments; we then split on the
  // OS separator and check the first segment.
  const normalized = path.normalize(filePath);
  const firstSegment = normalized.split(path.sep)[0];
  if (firstSegment && ADMIN_ALLOWED_DIRS.includes(firstSegment)) return 'ok';
  return 'forbidden';
}

/**
 * Filter a file tree to only include directories an admin can access.
 * Used for the GET /api/files tree response so admins don't see directory
 * names they can't open. Ops users see the unfiltered tree.
 */
function filterTreeForAdmin(tree: FileTreeEntry[]): FileTreeEntry[] {
  return tree.filter((entry) => ADMIN_ALLOWED_DIRS.includes(entry.name));
}

interface FileTreeEntry {
  name: string;
  path: string;
  type: 'file' | 'directory';
  children?: FileTreeEntry[];
  /** 'local' (default) or 'package' for installed package files. */
  source?: 'local' | 'package';
  /** npm package name if source is 'package'. */
  packageName?: string;
}

/** Convention directories to show in the file tree. */
const CONVENTION_DIRS = ['connections', 'skills', 'knowledge', 'automations', 'agents', 'stores', 'tools', 'evals'];

/**
 * Recursively build a file tree for a directory.
 * Only goes 3 levels deep to avoid runaway traversal.
 */
async function buildTree(
  dirPath: string,
  relativeTo: string,
  depth = 0,
  meta?: {source: 'package'; packageName: string},
): Promise<FileTreeEntry[]> {
  if (depth > 3) return [];

  let entries;
  try {
    entries = await readdir(dirPath, {withFileTypes: true});
  } catch {
    return [];
  }

  const result: FileTreeEntry[] = [];

  // Sort directories first, then files, both alphabetically
  const sorted = entries
    .filter((e) => !e.name.startsWith('.') || e.name === '.amodal')
    .sort((a, b) => {
      if (a.isDirectory() && !b.isDirectory()) return -1;
      if (!a.isDirectory() && b.isDirectory()) return 1;
      return a.name.localeCompare(b.name);
    });

  for (const entry of sorted) {
    const fullPath = path.join(dirPath, entry.name);
    const relPath = path.relative(relativeTo, fullPath);

    if (entry.isDirectory()) {
      const children = await buildTree(fullPath, relativeTo, depth + 1, meta);
      result.push({name: entry.name, path: relPath, type: 'directory', children, ...meta && {source: meta.source, packageName: meta.packageName}});
    } else {
      result.push({name: entry.name, path: relPath, type: 'file', ...meta && {source: meta.source, packageName: meta.packageName}});
    }
  }

  return result;
}

/**
 * Merge package file tree entries into the local tree.
 * Package entries appear inside the same convention directories as local files.
 * Local entries with the same path take precedence (aren't duplicated).
 * Recurses into subdirectories so package files appear alongside local files.
 */
function mergePackageTree(localTree: FileTreeEntry[], packageEntries: FileTreeEntry[]): void {
  for (const pkgEntry of packageEntries) {
    const existing = localTree.find((e) => e.name === pkgEntry.name && e.type === pkgEntry.type);
    if (existing && existing.type === 'directory' && existing.children && pkgEntry.children) {
      // Recurse into matching directories to merge at every level
      mergePackageTree(existing.children, pkgEntry.children);
      // Re-sort: directories first, then alphabetical
      existing.children.sort((a, b) => {
        if (a.type === 'directory' && b.type !== 'directory') return -1;
        if (a.type !== 'directory' && b.type === 'directory') return 1;
        return a.name.localeCompare(b.name);
      });
    } else if (!existing) {
      // Entry only exists in package, add it
      localTree.push(pkgEntry);
    }
    // If a local file exists with the same name, local takes precedence (skip package version)
  }
}

/**
 * Validate that a requested file path is within the repo and within convention dirs.
 * Prevents directory traversal attacks.
 */
function validateFilePath(repoPath: string, filePath: string): string | null {
  const resolved = path.resolve(repoPath, filePath);
  if (!resolved.startsWith(path.resolve(repoPath))) {
    return null;
  }
  return resolved;
}

export function createFilesRouter(options: FilesRouterOptions): Router {
  const router = Router();
  const {repoPath} = options;
  const roleProvider = options.roleProvider ?? defaultRoleProvider;

  const filesLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 100,
    standardHeaders: true,
    legacyHeaders: false,
  });

  /**
   * Resolve the user role for a request. Returns null + sends 401/403 if the
   * user is unauthenticated or below `user` level. Returns the role on success.
   *
   * We always require at least the `user` role to hit the files API — files
   * are admin/ops surface, end-users have no business here.
   *
   * All auth state transitions are logged with structured context so admins
   * filing "I can't access X" tickets have something to grep.
   */
  async function resolveRoleOrDeny(req: Request, res: Response): Promise<RuntimeRole | null> {
    let user;
    try {
      user = await roleProvider.resolveUser(req);
    } catch (err) {
      // RoleProvider failures are infrastructure errors. Log with context and
      // return 500 — we don't want to silently treat a broken provider as
      // "unauthenticated" because that would leak access if the provider is
      // misconfigured to throw on errors instead of returning null.
      log.error('files_role_provider_failed', {
        path: req.path,
        method: req.method,
        error: err instanceof Error ? err.message : String(err),
      });
      res.status(500).json({error: {code: 'role_provider_failed', message: 'Failed to resolve user role'}});
      return null;
    }

    if (!user) {
      log.warn('files_unauthenticated', {path: req.path, method: req.method});
      res.status(401).json({error: {code: 'unauthenticated', message: 'Authentication required'}});
      return null;
    }
    if (!hasRole(user, 'admin')) {
      // user role can't access files at all
      log.warn('files_role_denied', {
        path: req.path,
        method: req.method,
        user_id: user.id,
        current_role: user.role,
        required_role: 'admin',
      });
      res.status(403).json({
        error: {
          code: 'forbidden',
          message: 'Files API requires admin or ops role',
          required_role: 'admin',
          current_role: user.role,
        },
      });
      return null;
    }
    return user.role;
  }

  /**
   * Send a 403 for a per-path access denial and log the attempt with context.
   * Used by GET and PUT handlers when an admin tries to access a file outside
   * ADMIN_ALLOWED_DIRS.
   */
  function denyPathAccess(req: Request, res: Response, role: RuntimeRole, filePath: string): void {
    log.warn('files_path_denied', {
      path: req.path,
      method: req.method,
      file_path: filePath,
      current_role: role,
      required_role: 'ops',
    });
    res.status(403).json({
      error: {
        code: 'forbidden',
        message: `Path '${filePath}' is not accessible to ${role}`,
        required_role: 'ops',
        current_role: role,
      },
    });
  }

  /** Get the repo file tree (convention directories + config). */
  router.get('/api/files', filesLimiter, asyncHandler(async (req: Request, res: Response) => {
    const role = await resolveRoleOrDeny(req, res);
    if (!role) return;
    try {
      const tree: FileTreeEntry[] = [];

      // Add .amodal/config.json
      try {
        await stat(path.join(repoPath, '.amodal', 'config.json'));
        tree.push({
          name: '.amodal',
          path: '.amodal',
          type: 'directory',
          children: [{name: 'config.json', path: '.amodal/config.json', type: 'file'}],
        });
      } catch { /* no config */ }

      // Add convention directories (local files)
      for (const dir of CONVENTION_DIRS) {
        const dirPath = path.join(repoPath, dir);
        try {
          const s = await stat(dirPath);
          if (s.isDirectory()) {
            const children = await buildTree(dirPath, repoPath);
            tree.push({name: dir, path: dir, type: 'directory', children});
          }
        } catch { /* dir doesn't exist */ }
      }

      // Add installed package files (merged into convention directories)
      // Only load packages explicitly declared in amodal.json
      try {
        const configRaw = await readFile(path.join(repoPath, 'amodal.json'), 'utf-8');
        const parsed: unknown = JSON.parse(configRaw);
        // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- validated object above
        const config = (parsed && typeof parsed === 'object') ? parsed as Record<string, unknown> : {};
        const declaredPackages = Array.isArray(config['packages'])
          ? config['packages'].filter((p): p is string => typeof p === 'string')
          : [];

        for (const npmName of declaredPackages) {
          const pkgDir = path.join(repoPath, 'node_modules', ...npmName.split('/'));
          try {
            const s = await stat(pkgDir);
            if (!s.isDirectory()) continue;
          } catch { continue; /* package not installed */ }

          const meta = {source: 'package' as const, packageName: npmName};
          const pkgTree: FileTreeEntry[] = [];

          for (const dir of CONVENTION_DIRS) {
            const pkgConvDir = path.join(pkgDir, dir);
            try {
              const s = await stat(pkgConvDir);
              if (s.isDirectory()) {
                const children = await buildTree(pkgConvDir, pkgDir, 0, meta);
                pkgTree.push({name: dir, path: dir, type: 'directory', children, ...meta});
              }
            } catch { /* dir doesn't exist in package */ }
          }

          mergePackageTree(tree, pkgTree);
        }
      } catch { /* config read or package scan failed, skip packages */ }

      // Filter the tree by role: admins only see directories they can edit.
      // Ops see the unfiltered tree.
      const visibleTree = role === 'ops' ? tree : filterTreeForAdmin(tree);
      res.json({tree: visibleTree, repoPath});
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log.error('files_tree_failed', {path: req.path, error: msg});
      res.status(500).json({error: {code: 'FILES_FAILED', message: msg}});
    }
  }));

  /** Read a file's contents. Checks local repo first, then installed packages. */
  router.get('/api/files/*', filesLimiter, asyncHandler(async (req: Request, res: Response) => {
    const role = await resolveRoleOrDeny(req, res);
    if (!role) return;
    try {
      const filePath = req.params[0] ?? '';
      if (!filePath) {
        res.status(400).json({error: {code: 'BAD_REQUEST', message: 'File path required'}});
        return;
      }

      // Role gate: admins can only read files inside ADMIN_ALLOWED_DIRS.
      // Ops can read anything inside the repo.
      if (checkPathAccess(filePath, role) === 'forbidden') {
        denyPathAccess(req, res, role, filePath);
        return;
      }

      const resolved = validateFilePath(repoPath, filePath);
      if (!resolved) {
        res.status(403).json({error: {code: 'FORBIDDEN', message: 'Path outside repo'}});
        return;
      }

      let content: string | null = null;
      let source: 'local' | 'package' = 'local';

      // Try local repo first
      try {
        content = await readFile(resolved, 'utf-8');
      } catch { /* not found locally */ }

      // Fall back to declared packages
      if (content === null) {
        try {
          const configRaw = await readFile(path.join(repoPath, 'amodal.json'), 'utf-8');
          const parsed2: unknown = JSON.parse(configRaw);
          // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- validated object above
          const config = (parsed2 && typeof parsed2 === 'object') ? parsed2 as Record<string, unknown> : {};
          const declaredPackages = Array.isArray(config['packages'])
            ? config['packages'].filter((p): p is string => typeof p === 'string')
            : [];

          for (const npmName of declaredPackages) {
            const pkgRoot = path.join(repoPath, 'node_modules', ...npmName.split('/'));
            const pkgFilePath = validateFilePath(pkgRoot, filePath);
            if (!pkgFilePath) continue;
            try {
              content = await readFile(pkgFilePath, 'utf-8');
              source = 'package';
              break;
            } catch { /* not in this package */ }
          }
        } catch { /* config read or package scan failed */ }
      }

      if (content === null) {
        res.status(404).json({error: {code: 'NOT_FOUND', message: 'File not found'}});
        return;
      }

      const ext = path.extname(filePath).slice(1);
      res.json({path: filePath, content, language: extToLanguage(ext), source});
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log.error('files_read_failed', {file_path: req.params[0] ?? '', error: msg});
      res.status(500).json({error: {code: 'READ_FAILED', message: msg}});
    }
  }));

  /** Write a file's contents. Creates parent dirs if needed. */
  router.put('/api/files/*', filesLimiter, asyncHandler(async (req: Request, res: Response) => {
    const role = await resolveRoleOrDeny(req, res);
    if (!role) return;
    try {
      const filePath = req.params[0] ?? '';
      if (!filePath) {
        res.status(400).json({error: {code: 'BAD_REQUEST', message: 'File path required'}});
        return;
      }

      // Role gate: admins can only write files inside ADMIN_ALLOWED_DIRS.
      // Ops can write anything inside the repo.
      if (checkPathAccess(filePath, role) === 'forbidden') {
        denyPathAccess(req, res, role, filePath);
        return;
      }

      const resolved = validateFilePath(repoPath, filePath);
      if (!resolved) {
        res.status(403).json({error: {code: 'FORBIDDEN', message: 'Path outside repo'}});
        return;
      }

      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- Express parsed JSON body
      const body = req.body as Record<string, unknown>;
      const content = body['content'];
      if (typeof content !== 'string') {
        res.status(400).json({error: {code: 'BAD_REQUEST', message: 'content field required (string)'}});
        return;
      }

      // Create parent directories if needed
      await mkdir(path.dirname(resolved), {recursive: true});
      await writeFile(resolved, content, 'utf-8');

      log.info('files_write_succeeded', {file_path: filePath});
      res.json({path: filePath, saved: true});
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log.error('files_write_failed', {file_path: req.params[0] ?? '', error: msg});
      res.status(500).json({error: {code: 'WRITE_FAILED', message: msg}});
    }
  }));

  return router;
}

function extToLanguage(ext: string): string {
  switch (ext) {
    case 'json': return 'json';
    case 'md': return 'markdown';
    case 'yaml':
    case 'yml': return 'yaml';
    case 'js':
    case 'mjs': return 'javascript';
    case 'ts': return 'typescript';
    default: return 'text';
  }
}
