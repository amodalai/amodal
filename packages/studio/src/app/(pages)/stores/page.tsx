/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

/**
 * Store list page — shows all stores for the current agent with document counts.
 */

import { listStores } from '@/lib/store-queries';
import { getAgentId } from '@/lib/config';
import { storePath } from '@/lib/routes';
export const dynamic = 'force-dynamic';

export default async function StoresPage() {
  const agentId = getAgentId();
  const stores = await listStores(agentId);

  return (
    <div>
      <h1 className="text-xl font-semibold text-foreground">Stores</h1>
      <div className="mt-4 grid gap-3">
        {stores.map((store) => (
          <a
            key={store.store}
            href={storePath(store.store)}
            className="block p-4 bg-card border border-border rounded-lg hover:bg-muted transition-colors"
          >
            <div className="font-medium text-foreground">{store.store}</div>
            <div className="text-sm text-muted-foreground">
              {store.docCount} {store.docCount === 1 ? 'document' : 'documents'}
            </div>
          </a>
        ))}
        {stores.length === 0 && (
          <p className="text-muted-foreground">No stores configured.</p>
        )}
      </div>
    </div>
  );
}
