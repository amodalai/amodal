/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

/**
 * Store documents page — lists documents in a specific store.
 * Server Component fetches initial data; client handles real-time updates.
 */

import { listDocuments } from '@/lib/store-queries';
import { getAgentId } from '@/lib/config';
import { StoreDocumentList } from './StoreDocumentList';
export const dynamic = 'force-dynamic';

export default async function StoreDocumentsPage({
  params,
}: {
  params: Promise<{ name: string }>;
}) {
  const { name } = await params;
  const agentId = getAgentId();
  const documents = await listDocuments(agentId, name);

  // Serialize Date objects to ISO strings for the client component boundary
  const serialized = documents.map((doc) => ({
    ...doc,
    expiresAt: doc.expiresAt?.toISOString() ?? null,
    updatedAt: doc.updatedAt.toISOString(),
    createdAt: doc.createdAt.toISOString(),
  }));

  return <StoreDocumentList storeName={name} initialDocuments={serialized} agentId={agentId} />;
}
