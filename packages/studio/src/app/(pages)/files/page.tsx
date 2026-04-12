/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import { fetchFromRuntime } from '@/lib/runtime-client';
import { AgentOffline } from '@/components/AgentOffline';
import { FileEditor } from './FileEditor';

interface FileTreeEntry {
  name: string;
  path: string;
  type: 'file' | 'directory';
  children?: FileTreeEntry[];
  source?: 'local' | 'package';
  packageName?: string;
}

export default async function FilesPage() {
  let tree: FileTreeEntry[];
  try {
    const data = await fetchFromRuntime<{ tree: FileTreeEntry[] }>('/api/files');
    tree = data.tree ?? [];
  } catch {
    return <AgentOffline page="files" />;
  }

  return <FileEditor initialTree={tree} />;
}
