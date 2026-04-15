/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import { useState, useEffect } from 'react';
import { AgentOffline } from '@/components/AgentOffline';
import { FileEditor } from '@/components/views/FileEditor';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface FileTreeEntry {
  name: string;
  path: string;
  type: 'file' | 'directory';
  children?: FileTreeEntry[];
  source?: 'local' | 'package';
  packageName?: string;
}

// ---------------------------------------------------------------------------
// Route constants
// ---------------------------------------------------------------------------

const FILES_PROXY_ROUTE = '/api/runtime/files';

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export function FilesPage() {
  const [tree, setTree] = useState<FileTreeEntry[] | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    fetch(FILES_PROXY_ROUTE, { signal: AbortSignal.timeout(5_000) })
      .then((r) => {
        if (!r.ok) throw new Error(`Request failed: ${String(r.status)}`);
        // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- system boundary: parsing JSON response
        return r.json() as Promise<{ tree: FileTreeEntry[] }>;
      })
      .then((data) => setTree(data.tree ?? []))
      .catch(() => setError(true));
  }, []);

  if (error) return <AgentOffline page="files" />;
  if (!tree) return null;

  return <FileEditor initialTree={tree} />;
}
