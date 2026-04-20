/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

/**
 * Fetches eval suite definitions from the runtime's file tree.
 * Eval .md files live in the repo's evals/ directory — the runtime serves them
 * via GET /api/files. This replaces the previous Postgres-based approach.
 */

import { useState, useEffect, useCallback } from 'react';
import { useStudioConfig } from '../contexts/StudioConfigContext';
import { parseEvalMarkdown } from '../lib/eval-parser';
import type { ParsedEval } from '../lib/eval-parser';

interface FileTreeEntry {
  name: string;
  path: string;
  type: 'file' | 'directory';
  children?: FileTreeEntry[];
}

interface FileContentResponse {
  path: string;
  content: string;
  language: string;
}

export interface EvalSuiteFromRuntime extends ParsedEval {
  /** Synthetic ID: agent-scoped name */
  id: string;
}

export function useEvalSuites(): {
  suites: EvalSuiteFromRuntime[];
  loading: boolean;
  refresh: () => void;
} {
  const { runtimeUrl, agentId } = useStudioConfig();
  const [suites, setSuites] = useState<EvalSuiteFromRuntime[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchSuites = useCallback(() => {
    setLoading(true);

    fetch(`${runtimeUrl}/api/files`, { signal: AbortSignal.timeout(5_000) })
      .then((r) => {
        if (!r.ok) throw new Error(`Runtime returned ${String(r.status)}`);
        // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- system boundary: parsing runtime JSON
        return r.json() as Promise<{ tree: FileTreeEntry[] }>;
      })
      .then((data) => {
        const evalsDir = data.tree.find((e) => e.name === 'evals' && e.type === 'directory');
        if (!evalsDir?.children) {
          setSuites([]);
          setLoading(false);
          return;
        }

        const mdFiles = evalsDir.children.filter(
          (c) => c.type === 'file' && c.name.endsWith('.md'),
        );

        if (mdFiles.length === 0) {
          setSuites([]);
          setLoading(false);
          return;
        }

        // Fetch each eval file's content in parallel
        return Promise.all(
          mdFiles.map((file) =>
            fetch(`${runtimeUrl}/api/files/${encodeURIComponent(file.path)}`, {
              signal: AbortSignal.timeout(5_000),
            })
              .then((r) => {
                if (!r.ok) return null;
                // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- system boundary: parsing runtime JSON
                return r.json() as Promise<FileContentResponse>;
              })
              .catch(() => null),
          ),
        ).then((results) => {
          const parsed: EvalSuiteFromRuntime[] = [];
          for (const result of results) {
            if (!result) continue;
            const fileName = result.path.split('/').pop() ?? result.path;
            const eval_ = parseEvalMarkdown(result.content, fileName);
            parsed.push({ ...eval_, id: `${agentId}:${eval_.name}` });
          }
          setSuites(parsed);
          setLoading(false);
        });
      })
      .catch(() => {
        setSuites([]);
        setLoading(false);
      });
  }, [runtimeUrl, agentId]);

  useEffect(() => {
    fetchSuites();
  }, [fetchSuites]);

  return { suites, loading, refresh: fetchSuites };
}
