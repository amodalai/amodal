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
import rateLimit from 'express-rate-limit';

export interface FilesRouterOptions {
  repoPath: string;
}

interface FileTreeEntry {
  name: string;
  path: string;
  type: 'file' | 'directory';
  children?: FileTreeEntry[];
}

/** Convention directories to show in the file tree. */
const CONVENTION_DIRS = ['connections', 'skills', 'knowledge', 'automations', 'agents', 'stores', 'tools', 'evals'];

/**
 * Recursively build a file tree for a directory.
 * Only goes 3 levels deep to avoid runaway traversal.
 */
async function buildTree(dirPath: string, relativeTo: string, depth = 0): Promise<FileTreeEntry[]> {
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
      const children = await buildTree(fullPath, relativeTo, depth + 1);
      result.push({name: entry.name, path: relPath, type: 'directory', children});
    } else {
      result.push({name: entry.name, path: relPath, type: 'file'});
    }
  }

  return result;
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
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100, // limit each IP to 100 requests per windowMs for file operations
  });

  router.use('/api/files', filesLimiter);


  const filesRateLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100, // limit each IP to 100 requests per windowMs for file operations
    standardHeaders: true,
    legacyHeaders: false,
  });

  /** Get the repo file tree (convention directories + config). */
  router.get('/api/files', filesRateLimiter, async (_req: Request, res: Response) => {
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

      // Add convention directories
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

      res.json({tree, repoPath});
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({error: {code: 'FILES_FAILED', message: msg}});
    }
  });

  /** Read a file's contents. */
  router.get('/api/files/*', filesRateLimiter, async (req: Request, res: Response) => {
    try {
      // Extract path after /api/files/
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

      const content = await readFile(resolved, 'utf-8');
      const ext = path.extname(filePath).slice(1);

      res.json({path: filePath, content, language: extToLanguage(ext)});
    } catch (err) {
      if (err instanceof Error && 'code' in err && (err as unknown as {code: string}).code === 'ENOENT') { // eslint-disable-line @typescript-eslint/no-unsafe-type-assertion -- Node errno check
        res.status(404).json({error: {code: 'NOT_FOUND', message: 'File not found'}});
        return;
      }
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({error: {code: 'READ_FAILED', message: msg}});
    }
  });

  /** Write a file's contents. Creates parent dirs if needed. */
  router.put('/api/files/*', async (req: Request, res: Response) => {
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
