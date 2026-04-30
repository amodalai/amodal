/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import { useState, useEffect } from 'react';
import { runtimeApiUrl } from '@/lib/api';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface FileTreeEntry {
  name: string;
  path: string;
  type: 'file' | 'directory';
  children?: FileTreeEntry[];
}

interface FilesResponse {
  tree: FileTreeEntry[];
}

export interface AgentInventory {
  skills: string[];
  knowledge: string[];
  connections: string[];
  stores: string[];
  automations: string[];
  pages: string[];
  loading: boolean;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Extract direct child names from a top-level directory in the tree. */
function extractChildNames(tree: FileTreeEntry[], dirName: string): string[] {
  const dir = tree.find((e) => e.name === dirName && e.type === 'directory');
  if (!dir?.children) return [];
  return dir.children
    .map((c) => c.type === 'file' ? c.name.replace(/\.[^.]+$/, '') : c.name)
    .sort();
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useAgentInventory(): AgentInventory {
  const [inventory, setInventory] = useState<Omit<AgentInventory, 'loading'> | null>(null);

  useEffect(() => {
    fetch(runtimeApiUrl('/api/files'), { signal: AbortSignal.timeout(5_000) })
      .then((r) => {
        if (!r.ok) throw new Error(`Runtime returned ${String(r.status)}`);
        // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- system boundary: parsing JSON response
        return r.json() as Promise<FilesResponse>;
      })
      .then((data) => {
        const tree = data.tree;
        setInventory({
          skills: extractChildNames(tree, 'skills'),
          knowledge: extractChildNames(tree, 'knowledge'),
          connections: extractChildNames(tree, 'connections'),
          stores: extractChildNames(tree, 'stores'),
          automations: extractChildNames(tree, 'automations'),
          pages: extractChildNames(tree, 'pages'),
        });
      })
      .catch(() => {
        // If the runtime is unreachable, show nothing rather than an error —
        // the individual pages already handle offline state.
        setInventory({
          skills: [],
          knowledge: [],
          connections: [],
          stores: [],
          automations: [],
          pages: [],
        });
      });
  }, []);

  if (!inventory) {
    return {
      skills: [],
      knowledge: [],
      connections: [],
      stores: [],
      automations: [],
      pages: [],
      loading: true,
    };
  }

  return { ...inventory, loading: false };
}
