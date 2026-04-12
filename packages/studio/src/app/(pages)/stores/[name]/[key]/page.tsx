/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

/**
 * Document detail page — shows a single store document with its version history.
 */

import { getDocument, getDocumentHistory } from '@/lib/store-queries';
import { getAgentId } from '@/lib/config';
import { DocumentView } from './DocumentView';
export const dynamic = 'force-dynamic';

export default async function DocumentDetailPage({
  params,
}: {
  params: Promise<{ name: string; key: string }>;
}) {
  const { name, key } = await params;
  const decodedKey = decodeURIComponent(key);
  const agentId = getAgentId();

  const [document, history] = await Promise.all([
    getDocument(agentId, name, decodedKey),
    getDocumentHistory(agentId, name, decodedKey),
  ]);

  if (!document) {
    return <div className="text-muted-foreground">Document not found.</div>;
  }

  // Serialize Date objects to ISO strings for the client component boundary
  const serializedDoc = {
    ...document,
    expiresAt: document.expiresAt?.toISOString() ?? null,
    updatedAt: document.updatedAt.toISOString(),
    createdAt: document.createdAt.toISOString(),
  };

  const serializedHistory = history.map((ver) => ({
    ...ver,
    createdAt: ver.createdAt.toISOString(),
  }));

  return <DocumentView document={serializedDoc} history={serializedHistory} storeName={name} />;
}
