/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { DocumentView } from '@/components/views/DocumentView';
import { apiDocumentPath } from '@/lib/routes';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export function DocumentViewPage() {
  const { name, key } = useParams<{ name: string; key: string }>();
  const [doc, setDoc] = useState<DocumentRow | null>(null);
  const [history, setHistory] = useState<VersionRow[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!name || !key) return;
    const decodedKey = decodeURIComponent(key);

    fetch(apiDocumentPath(name, decodedKey), { signal: AbortSignal.timeout(5_000) })
      .then((r) => {
        if (!r.ok) throw new Error(`Request failed: ${String(r.status)}`);
        // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- system boundary: parsing JSON response
        return r.json() as Promise<{ document: DocumentRow | null; history: VersionRow[] }>;
      })
      .then((data) => {
        setDoc(data.document);
        setHistory(data.history);
      })
      .catch(() => {
        // Leave doc as null
      })
      .finally(() => setLoaded(true));
  }, [name, key]);

  if (!name || !key) return null;
  if (!loaded) return null;

  if (!doc) {
    return <div className="text-muted-foreground">Document not found.</div>;
  }

  return <DocumentView document={doc} history={history} storeName={name} />;
}
