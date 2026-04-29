/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Database } from 'lucide-react';
import { AgentOffline } from '@/components/AgentOffline';
import { studioApiUrl } from '@/lib/api';
import { storePath } from '@/lib/routes';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface StoreInfo {
  store: string;
  docCount: number;
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export function StoresPage() {
  const [stores, setStores] = useState<StoreInfo[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(studioApiUrl('/api/stores'), { signal: AbortSignal.timeout(5_000) })
      .then((r) => {
        if (!r.ok) throw new Error(`Request failed: ${String(r.status)}`);
        // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- system boundary: parsing JSON response
        return r.json() as Promise<{ stores: StoreInfo[] }>;
      })
      .then((d) => setStores(d.stores))
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => setLoaded(true));
  }, []);

  if (!loaded) return null;
  if (error) return <AgentOffline page="stores" detail={error} />;

  return (
    <div>
      <h1 className="text-xl font-semibold text-foreground">Stores</h1>
      <div className="mt-4 grid gap-3">
        {stores.map((store) => (
          <Link
            key={store.store}
            to={storePath(store.store)}
            className="block p-4 bg-card border border-border rounded-lg hover:bg-muted transition-colors"
          >
            <div className="font-medium text-foreground">{store.store}</div>
            <div className="text-sm text-muted-foreground">
              {store.docCount} {store.docCount === 1 ? 'document' : 'documents'}
            </div>
          </Link>
        ))}
        {stores.length === 0 && (
          <div className="text-center py-16 border border-border border-dashed rounded-lg">
            <Database className="w-8 h-8 text-muted-foreground mx-auto mb-3" />
            <p className="text-sm text-muted-foreground">No store data yet.</p>
            <p className="text-xs text-muted-foreground mt-1">
              Stores are populated when your agent writes documents during chat sessions.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
