/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

/**
 * Client component for the document detail page.
 * Renders document fields and version history, with real-time refresh
 * on store_updated events.
 */

import { useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { useStudioEvents } from '@/contexts/StudioEventsContext';
import { VersionHistory } from '@/components/entity/VersionHistory';
import { apiDocumentPath } from '@/lib/routes';
import { createBrowserLogger } from '@/lib/browser-logger';
import type { StoreDocument } from '@/components/types';

const log = createBrowserLogger('DocumentView');

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Dates arrive as ISO strings from both Server Component serialization and API JSON. */
interface DocumentRow {
  key: string;
  appId: string;
  store: string;
  version: number;
  payload: Record<string, unknown>;
  meta: Record<string, unknown>;
  expiresAt: string | null;
  updatedAt: string;
  createdAt: string;
}

/** Version rows from the storeDocumentVersions table. */
interface VersionRow {
  id: number;
  key: string;
  appId: string;
  store: string;
  version: number;
  payload: Record<string, unknown>;
  meta: Record<string, unknown>;
  createdAt: string;
}

interface DocumentViewProps {
  document: DocumentRow;
  history: VersionRow[];
  storeName: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatTime(value: string): string {
  const date = new Date(value);
  const now = Date.now();
  const diff = now - date.getTime();

  if (diff < 60000) return 'just now';
  if (diff < 3600000) return `${String(Math.floor(diff / 60000))} min ago`;
  if (diff < 86400000) return `${String(Math.floor(diff / 3600000))}h ago`;
  return date.toLocaleString();
}

function optString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function optNumber(value: unknown): number | undefined {
  return typeof value === 'number' ? value : undefined;
}

/** Convert DB version row to StoreDocument shape for VersionHistory. */
function toStoreDocument(row: VersionRow): StoreDocument {
  const m = row.meta;
  const computedAt = optString(m['computedAt']);
  return {
    key: row.key,
    appId: row.appId,
    store: row.store,
    version: row.version,
    payload: row.payload,
    meta: {
      computedAt: computedAt ?? row.createdAt,
      stale: typeof m['stale'] === 'boolean' ? m['stale'] : false,
      ttl: optNumber(m['ttl']),
      automationId: optString(m['automationId']),
      skillId: optString(m['skillId']),
      modelUsed: optString(m['modelUsed']),
      tokenCost: optNumber(m['tokenCost']),
      estimatedCostUsd: optNumber(m['estimatedCostUsd']),
      durationMs: optNumber(m['durationMs']),
      trace: optString(m['trace']),
    },
  };
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function DocumentView({ document: initialDoc, history: initialHistory, storeName }: DocumentViewProps) {
  const [doc, setDoc] = useState(initialDoc);
  const [history, setHistory] = useState(initialHistory);

  const refetch = useCallback(async () => {
    try {
      const res = await fetch(apiDocumentPath(storeName, doc.key));
      if (!res.ok) {
        throw new Error(`Failed to fetch document: ${String(res.status)}`);
      }
      // System boundary: parsing our own API route response
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      const data = (await res.json()) as { document: DocumentRow | null; history: VersionRow[] };
      if (data.document) {
        setDoc(data.document);
      }
      setHistory(data.history);
    } catch (err: unknown) {
      log.error('document_refetch_failed', {
        store: storeName,
        key: doc.key,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }, [storeName, doc.key]);

  useStudioEvents(['store_updated'], useCallback((payload: unknown) => {
    // SSE event payload shape — system boundary cast
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
    const event = payload as { store?: string; key?: string } | null;
    if (!event?.store || event.store === storeName) {
      void refetch();
    }
  }, [storeName, refetch]));

  const payload = doc.payload;
  const meta = doc.meta;
  const historyDocs = history.map(toStoreDocument);

  return (
    <div className="space-y-5">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Link to="../.." className="hover:text-foreground transition-colors">
          Stores
        </Link>
        <span>/</span>
        <Link to=".." className="hover:text-foreground transition-colors">
          {storeName}
        </Link>
        <span>/</span>
        <span className="text-foreground font-medium">{doc.key}</span>
      </div>

      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">{doc.key}</h1>
        <span className="text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded font-mono">
          v{String(doc.version)}
        </span>
      </div>

      {/* Payload fields */}
      <div className="bg-card border border-border rounded-xl divide-y divide-border">
        {Object.entries(payload).map(([fieldName, value]) => (
          <div key={fieldName} className="px-5 py-3.5 flex">
            <div className="w-44 text-sm font-medium text-muted-foreground shrink-0 pt-0.5">
              {fieldName}
            </div>
            <div className="text-sm flex-1 min-w-0 text-foreground">
              <FieldValue value={value} />
            </div>
          </div>
        ))}
        {Object.keys(payload).length === 0 && (
          <div className="px-5 py-3.5 text-sm text-muted-foreground">Empty payload.</div>
        )}
      </div>

      {/* Metadata */}
      <div className="bg-card border border-border rounded-xl p-5">
        <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-widest mb-3">
          Metadata
        </h2>
        <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
          <MetaItem label="Updated" value={formatTime(doc.updatedAt)} />
          <MetaItem label="Created" value={formatTime(doc.createdAt)} />
          {meta['computedAt'] != null && (
            <MetaItem label="Computed" value={formatTime(String(meta['computedAt']))} />
          )}
          {meta['modelUsed'] != null && (
            <MetaItem label="Model" value={String(meta['modelUsed'])} />
          )}
          {meta['durationMs'] != null && (
            <MetaItem label="Duration" value={`${String(meta['durationMs'])}ms`} />
          )}
          {meta['tokenCost'] != null && (
            <MetaItem label="Tokens" value={Number(meta['tokenCost']).toLocaleString()} />
          )}
          {meta['estimatedCostUsd'] != null && (
            <MetaItem label="Cost" value={`$${Number(meta['estimatedCostUsd']).toFixed(4)}`} />
          )}
        </div>
      </div>

      {/* Reasoning trace */}
      {meta['trace'] != null && (
        <details className="bg-card border border-border rounded-xl group">
          <summary className="px-5 py-3.5 cursor-pointer text-sm font-medium text-muted-foreground hover:text-foreground transition-colors">
            Reasoning Trace
          </summary>
          <pre className="px-5 py-4 border-t border-border text-xs whitespace-pre-wrap text-muted-foreground bg-muted overflow-auto max-h-96 scrollbar-thin font-mono">
            {String(meta['trace'])}
          </pre>
        </details>
      )}

      {/* Version history */}
      <VersionHistory history={historyDocs} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function MetaItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center gap-2 text-sm">
      <span className="text-muted-foreground">{label}:</span>
      <span className="text-foreground font-mono text-xs truncate">{value}</span>
    </div>
  );
}

function FieldValue({ value }: { value: unknown }) {
  if (value === null || value === undefined) {
    return <span className="text-muted-foreground italic">null</span>;
  }
  if (typeof value === 'boolean') {
    return <span className="font-mono">{String(value)}</span>;
  }
  if (typeof value === 'number') {
    return <span className="font-mono">{String(value)}</span>;
  }
  if (typeof value === 'string') {
    if (value.length > 300) {
      return (
        <details>
          <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
            {value.slice(0, 120)}...
          </summary>
          <pre className="mt-1 whitespace-pre-wrap text-xs bg-muted/30 rounded p-2 overflow-auto max-h-60">
            {value}
          </pre>
        </details>
      );
    }
    return <span>{value}</span>;
  }
  // Objects and arrays
  return (
    <pre className="whitespace-pre-wrap text-xs bg-muted/30 rounded p-2 overflow-auto max-h-40 font-mono">
      {JSON.stringify(value, null, 2)}
    </pre>
  );
}
