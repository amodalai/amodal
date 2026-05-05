/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

/**
 * Client component for the store documents page.
 * Renders document cards and subscribes to real-time store_updated events
 * to refetch documents via the Studio API route.
 */

import { useState, useCallback } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useStudioEvents } from '@/contexts/StudioEventsContext';
import { apiStoreDocumentsPath, documentPathSegment } from '@/lib/routes';
import { createBrowserLogger } from '@/lib/browser-logger';

const log = createBrowserLogger('StoreDocumentList');

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Dates arrive as ISO strings from both Server Component serialization and API JSON. */
interface StoreDocRow {
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

interface StoreDocumentListProps {
  storeName: string;
  initialDocuments: StoreDocRow[];
  agentId: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatRelativeTime(value: string): string {
  const date = new Date(value);
  const diff = Date.now() - date.getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${String(mins)}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${String(hours)}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${String(days)}d ago`;
  return date.toLocaleDateString();
}

/** Pick a summary string from the payload for display. */
function pickSummary(payload: Record<string, unknown>): string | null {
  for (const key of ['title', 'name', 'summary', 'subject', 'description']) {
    const val = payload[key];
    if (typeof val === 'string' && val.length > 0) {
      return val.length > 120 ? val.slice(0, 120) + '...' : val;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function StoreDocumentList({
  storeName,
  initialDocuments,
  agentId: _agentId,
}: StoreDocumentListProps) {
  const [documents, setDocuments] = useState(initialDocuments);
  const navigate = useNavigate();

  const refetch = useCallback(async () => {
    try {
      const res = await fetch(apiStoreDocumentsPath(storeName));
      if (!res.ok) {
        throw new Error(`Failed to fetch documents: ${String(res.status)}`);
      }
      // System boundary: parsing our own API route response
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      const data = (await res.json()) as { documents: StoreDocRow[] };
      setDocuments(data.documents);
    } catch (err: unknown) {
      log.error('store_document_refetch_failed', {
        store: storeName,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }, [storeName]);

  useStudioEvents(['store_updated'], useCallback((payload: unknown) => {
    // SSE event payload shape — system boundary cast
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
    const event = payload as { store?: string } | null;
    // Only refetch if the event is for this store (or if no store specified)
    if (!event?.store || event.store === storeName) {
      void refetch();
    }
  }, [storeName, refetch]));

  return (
    <div>
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-sm text-muted-foreground mb-4">
        <Link to=".." className="hover:text-foreground transition-colors">
          Stores
        </Link>
        <span>/</span>
        <span className="text-foreground font-medium">{storeName}</span>
      </div>

      <div className="flex items-center justify-between mb-4">
        <h1 className="text-xl font-semibold text-foreground">{storeName}</h1>
        <span className="text-sm text-muted-foreground">
          {documents.length} {documents.length === 1 ? 'document' : 'documents'}
        </span>
      </div>

      {documents.length === 0 ? (
        <p className="text-center py-16 text-muted-foreground text-sm">No documents yet.</p>
      ) : (
        <div className="space-y-2">
          {documents.map((doc) => {
            const summary = pickSummary(doc.payload);

            return (
              <div
                key={doc.key}
                onClick={() => void navigate(documentPathSegment(doc.key))}
                className="border border-border rounded-xl p-4 cursor-pointer hover:bg-muted transition-colors"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-foreground mb-1">{doc.key}</div>
                    {summary && (
                      <div className="text-xs text-muted-foreground mb-1.5 line-clamp-2">
                        {summary}
                      </div>
                    )}
                    <div className="text-[11px] text-muted-foreground">
                      v{String(doc.version)}
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-1 shrink-0">
                    <span className="text-[11px] text-muted-foreground">
                      {formatRelativeTime(doc.updatedAt)}
                    </span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
