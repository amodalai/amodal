/**
 * @license
 * Copyright 2025 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import { useCallback, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useStoreList } from '@amodalai/react';
import { useRuntimeManifest } from '@/contexts/RuntimeContext';
import { useRuntimeEvents } from '@/contexts/RuntimeEventsContext';
import { EntityTable } from '@/components/entity/EntityTable';
import { Database } from 'lucide-react';

/**
 * Auto-rendered entity list page for a store.
 */
export function EntityListPage() {
  const { storeName } = useParams<{ storeName: string }>();
  const { stores } = useRuntimeManifest();
  const [sort, setSort] = useState<string | undefined>();
  const [filter, setFilter] = useState<Record<string, unknown> | undefined>();

  const store = stores.find((s) => s.name === storeName);

  const { documents, total, isLoading, error, refetch } = useStoreList(storeName ?? '', {
    sort,
    filter,
    limit: 50,
    refreshInterval: 15000,
  });

  // Refresh immediately when a store write happens (instead of waiting
  // for the 15s poll). Fires on any store_updated event — the hook
  // re-fetches the current store's data.
  useRuntimeEvents(['store_updated'], refetch);

  const handleSortChange = useCallback((newSort: string) => {
    setSort(newSort);
  }, []);

  const handleFilterChange = useCallback((newFilter: Record<string, unknown>) => {
    setFilter(Object.keys(newFilter).length > 0 ? newFilter : undefined);
  }, []);

  if (!store) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
        Store &ldquo;{storeName}&rdquo; not found.
      </div>
    );
  }

  return (
    <div className="max-w-[1200px] mx-auto px-6 pt-8 pb-12">
      <div className="flex items-center gap-3 mb-6">
        <div className="h-9 w-9 rounded-lg bg-primary/10 dark:bg-primary/10 flex items-center justify-center">
          <Database className="h-5 w-5 text-primary dark:text-primary" />
        </div>
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-foreground">{store.entity.name}</h1>
          <p className="text-sm text-muted-foreground">
            {total.toLocaleString()} document{total !== 1 ? 's' : ''} in <span className="font-mono text-xs">{store.name}</span>
          </p>
        </div>
      </div>

      {error && (
        <div className="mb-4 p-3 rounded-md bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/20 text-red-700 dark:text-red-300 text-sm">
          {error}
        </div>
      )}

      {isLoading ? (
        <div className="flex items-center justify-center py-16 text-muted-foreground text-sm">Loading...</div>
      ) : (
        <EntityTable
          storeName={storeName ?? ''}
          schema={store.entity.schema}
          keyTemplate={store.entity.key}
          documents={documents}
          total={total}
          onSortChange={handleSortChange}
          onFilterChange={handleFilterChange}
        />
      )}
    </div>
  );
}
