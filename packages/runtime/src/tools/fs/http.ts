/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

/**
 * `HttpFsBackend` — implements `FsBackend` by calling a remote runtime's
 * workspace API over HTTP. Used when the admin agent needs to read/write
 * files on a different agent's Fly machine.
 *
 * Endpoints:
 *   GET  /api/files          → file tree
 *   GET  /api/files/{path}   → { path, content }
 *   PUT  /api/files/{path}   → write file
 *   DELETE /api/files/{path} → delete file
 */

import type {FsBackend, RepoFileEntry, RepoDirListing} from '@amodalai/types';

export interface HttpFsBackendOptions {
  /** Base URL of the target runtime (e.g., https://tesseric-agent.amodalapp.com) */
  runtimeUrl: string;
  /** Auth token to include in requests */
  authToken?: string;
  /** Timeout per request in ms (default: 10_000) */
  timeoutMs?: number;
}

export class HttpFsBackend implements FsBackend {
  private readonly baseUrl: string;
  private readonly authToken?: string;
  private readonly timeoutMs: number;

  constructor(opts: HttpFsBackendOptions) {
    this.baseUrl = opts.runtimeUrl.replace(/\/+$/, '');
    this.authToken = opts.authToken;
    this.timeoutMs = opts.timeoutMs ?? 10_000;
  }

  private headers(): Record<string, string> {
    const h: Record<string, string> = {'Content-Type': 'application/json'};
    if (this.authToken) h['Authorization'] = `Bearer ${this.authToken}`;
    return h;
  }

  async readRepoFile(repoPath: string): Promise<string> {
    const res = await fetch(`${this.baseUrl}/api/files/${encodeURIComponent(repoPath)}`, {
      headers: this.headers(),
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    if (!res.ok) throw new Error(`Failed to read ${repoPath}: ${res.status}`);
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- system boundary: parsing workspace API JSON
    const data = await res.json() as {content: string};
    return data.content;
  }

  async writeRepoFile(repoPath: string, content: string): Promise<void> {
    const res = await fetch(`${this.baseUrl}/api/files/${encodeURIComponent(repoPath)}`, {
      method: 'PUT',
      headers: this.headers(),
      body: JSON.stringify({content}),
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    if (!res.ok) throw new Error(`Failed to write ${repoPath}: ${res.status}`);
  }

  async readManyRepoFiles(repoPaths: string[]): Promise<RepoFileEntry[]> {
    const results: RepoFileEntry[] = [];
    for (const p of repoPaths) {
      try {
        const content = await this.readRepoFile(p);
        results.push({path: p, content});
      } catch {
        // Skip missing files (matches LocalFsBackend behavior)
      }
    }
    return results;
  }

  async listRepoFiles(repoPath: string): Promise<RepoDirListing> {
    const res = await fetch(`${this.baseUrl}/api/files`, {
      headers: this.headers(),
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    if (!res.ok) return {directories: [], files: []};

    interface TreeNode { name: string; path: string; type: string; children?: TreeNode[] }
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- system boundary: parsing workspace API JSON
    const data = await res.json() as {tree: TreeNode[]};

    // Find the requested directory in the tree
    const parts = repoPath.split('/').filter((p) => p && p !== '.');
    let nodes: TreeNode[] = data.tree;
    for (const part of parts) {
      const dir = nodes.find((n) => n.name === part && n.type === 'directory');
      if (!dir?.children) return {directories: [], files: []};
      nodes = dir.children;
    }

    return {
      directories: nodes.filter((n) => n.type === 'directory').map((n) => n.name),
      files: nodes.filter((n) => n.type === 'file').map((n) => n.name),
    };
  }

  async deleteRepoFile(repoPath: string): Promise<void> {
    const res = await fetch(`${this.baseUrl}/api/files/${encodeURIComponent(repoPath)}`, {
      method: 'DELETE',
      headers: this.headers(),
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    if (!res.ok) throw new Error(`Failed to delete ${repoPath}: ${res.status}`);
  }
}
