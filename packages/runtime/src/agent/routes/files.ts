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
import {readLockFile, getNpmContextPaths} from '@amodalai/core';

export interface FilesRouterOptions {
  repoPath: string;
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
 */
function mergePackageTree(localTree: FileTreeEntry[], packageEntries: FileTreeEntry[]): void {
  for (const pkgEntry of packageEntries) {
    // Find matching top-level directory in local tree
    const existing = localTree.find((e) => e.name === pkgEntry.name && e.type === 'directory');
    if (existing && existing.children && pkgEntry.children) {
      // Merge children: add package children that don't already exist locally
      const localPaths = new Set(existing.children.map((c) => c.path));
      for (const child of pkgEntry.children) {
        if (!localPaths.has(child.path)) {
          existing.children.push(child);
        }
      }
      // Re-sort: directories first, then alphabetical
      existing.children.sort((a, b) => {
        if (a.type === 'directory' && b.type !== 'directory') return -1;
        if (a.type !== 'directory' && b.type === 'directory') return 1;
        return a.name.localeCompare(b.name);
      });
    } else if (!existing) {
      // Convention directory only exists in packages, add it
      localTree.push(pkgEntry);
    }
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

  const filesLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 100,
    standardHeaders: true,
    legacyHeaders: false,
  });

  /** Get the repo file tree (convention directories + config). */
  router.get('/api/files', filesLimiter, async (_req: Request, res: Response) => {
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
      try {
        const lockFile = await readLockFile(repoPath);
        if (lockFile && Object.keys(lockFile.packages).length > 0) {
          const paths = getNpmContextPaths(repoPath);
          const scopeDir = path.join(paths.nodeModules, '@amodalai');
          let pkgDirs: string[] = [];
          try {
            const entries = await readdir(scopeDir, {withFileTypes: true});
            pkgDirs = entries.filter((e) => e.isDirectory()).map((e) => e.name);
          } catch { /* no packages dir */ }

          for (const pkgDirName of pkgDirs) {
            const npmName = `@amodalai/${pkgDirName}`;
            if (!lockFile.packages[npmName]) continue;

            const pkgDir = path.join(scopeDir, pkgDirName);
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
        }
      } catch { /* lock file read failed, skip packages */ }

      res.json({tree, repoPath});
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({error: {code: 'FILES_FAILED', message: msg}});
    }
  });

  /** Read a file's contents. Checks local repo first, then installed packages. */
  router.get('/api/files/*', filesLimiter, async (req: Request, res: Response) => {
    try {
      const filePath = req.params[0] ?? '';
      if (!filePath) {
        res.status(400).json({error: {code: 'BAD_REQUEST', message: 'File path required'}});
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

      // Fall back to installed packages
      if (content === null) {
        try {
          const lockFile = await readLockFile(repoPath);
          if (lockFile) {
            const paths = getNpmContextPaths(repoPath);
            const scopeDir = path.join(paths.nodeModules, '@amodalai');
            let pkgDirs: string[] = [];
            try {
              const entries = await readdir(scopeDir, {withFileTypes: true});
              pkgDirs = entries.filter((e) => e.isDirectory()).map((e) => e.name);
            } catch { /* */ }

            for (const pkgDirName of pkgDirs) {
              const npmName = `@amodalai/${pkgDirName}`;
              if (!lockFile.packages[npmName]) continue;
              const pkgFilePath = path.join(scopeDir, pkgDirName, filePath);
              try {
                content = await readFile(pkgFilePath, 'utf-8');
                source = 'package';
                break;
              } catch { /* not in this package */ }
            }
          }
        } catch { /* lock file read failed */ }
      }

      if (content === null) {
        res.status(404).json({error: {code: 'NOT_FOUND', message: 'File not found'}});
        return;
      }

      const ext = path.extname(filePath).slice(1);
      res.json({path: filePath, content, language: extToLanguage(ext), source});
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({error: {code: 'READ_FAILED', message: msg}});
    }
  });

  /** Write a file's contents. Creates parent dirs if needed. */
  router.put('/api/files/*', filesLimiter, async (req: Request, res: Response) => {
    try {
      const filePath = req.params[0] ?? '';
      if (!filePath) {
        res.status(400).json({error: {code: 'BAD_REQUEST', message: 'File path required'}});
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

      res.json({path: filePath, saved: true});
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({error: {code: 'WRITE_FAILED', message: msg}});
    }
  });

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
