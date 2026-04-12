/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import type { StoreDocument } from '../types';

export interface VersionHistoryProps {
  history: StoreDocument[];
}

/**
 * Renders a version timeline for a document's history.
 */
export function VersionHistory({ history }: VersionHistoryProps) {
  if (history.length === 0) return null;

  return (
    <div className="border border-border rounded-lg p-4 space-y-3">
      <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
        Version History
      </h2>
      <div className="space-y-3">
        {history.map((ver) => (
          <div key={ver.version} className="relative pl-6 pb-3 border-l-2 border-muted last:pb-0">
            {/* Timeline dot */}
            <div className="absolute -left-[5px] top-1 h-2 w-2 rounded-full bg-muted-foreground" />

            <div className="flex items-center justify-between mb-1">
              <span className="text-sm font-medium">v{ver.version}</span>
              <span className="text-xs text-muted-foreground">
                {new Date(ver.meta.computedAt).toLocaleString()}
              </span>
            </div>

            <details className="text-xs">
              <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
                View payload
              </summary>
              <pre className="mt-1 whitespace-pre-wrap bg-muted/30 rounded p-2 overflow-auto max-h-40">
                {JSON.stringify(ver.payload, null, 2)}
              </pre>
            </details>
          </div>
        ))}
      </div>
    </div>
  );
}
