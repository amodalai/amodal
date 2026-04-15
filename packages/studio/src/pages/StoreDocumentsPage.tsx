/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { StoreDocumentList } from '@/components/views/StoreDocumentList';
import { useStudioConfig } from '../contexts/StudioConfigContext';
import { apiStoreDocumentsPath } from '@/lib/routes';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export function StoreDocumentsPage() {
  const { name } = useParams<{ name: string }>();
  const { agentId } = useStudioConfig();
  const [documents, setDocuments] = useState<StoreDocRow[] | null>(null);

  useEffect(() => {
    if (!name) return;
    fetch(apiStoreDocumentsPath(name), { signal: AbortSignal.timeout(5_000) })
      .then((r) => {
        if (!r.ok) throw new Error(`Request failed: ${String(r.status)}`);
        // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- system boundary: parsing JSON response
        return r.json() as Promise<{ documents: StoreDocRow[] }>;
      })
      .then((d) => setDocuments(d.documents))
      .catch(() => setDocuments([]));
  }, [name]);

  if (!name || !documents) return null;

  return <StoreDocumentList storeName={name} initialDocuments={documents} agentId={agentId} />;
}
