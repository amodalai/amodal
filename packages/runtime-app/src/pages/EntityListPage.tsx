/**
 * @license
 * Copyright 2025 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import { useCallback, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useStoreList } from '@amodalai/react';
import { useRuntimeManifest } from '@/contexts/RuntimeContext';
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

  const { documents, total, isLoading, error } = useStoreList(storeName ?? '', {
    sort,
    filter,
    limit: 50,
    refreshInterval: 15000,
  });

  const handleSortChange = useCallback((newSort: string) => {
    setSort(newSort);
  }, []);

  const handleFilterChange = useCallback((newFilter: Record<string, unknown>) => {
    setFilter(Object.keys(newFilter).length > 0 ? newFilter : undefined);
  }, []);

  if (!store) {
    return (
      <div className="flex items-center justify-center h-full text-gray-400 text-sm">
        Store &ldquo;{storeName}&rdquo; not found.
      </div>
    );
  }

  return (
    <div className="max-w-[1200px] mx-auto px-6 pt-8 pb-12">
      <div className="flex items-center gap-3 mb-6">
        <div className="h-9 w-9 rounded-lg bg-indigo-50 flex items-center justify-center">
          <Database className="h-5 w-5 text-indigo-500" />
        </div>
        <div>
          <h1 className="text-xl font-semibold tracking-tight">{store.entity.name}</h1>
          <p className="text-sm text-gray-500">
            {total.toLocaleString()} document{total !== 1 ? 's' : ''} in <span className="font-mono text-xs">{store.name}</span>
          </p>
        </div>
      </div>

      {error && (
        <div className="mb-4 p-3 rounded-md bg-red-50 border border-red-200 text-red-700 text-sm">
          {error}
        </div>
      )}

      {isLoading ? (
        <div className="flex items-center justify-center py-16 text-gray-400 text-sm">Loading...</div>
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
