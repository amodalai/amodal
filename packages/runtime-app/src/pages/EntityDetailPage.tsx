/**
 * @license
 * Copyright 2025 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import { useParams, useNavigate } from 'react-router-dom';
import { useStore } from '@amodalai/react';
import { useRuntimeManifest } from '@/contexts/RuntimeContext';
import { EntityDetail } from '@/components/entity/EntityDetail';
import { ArrowLeft } from 'lucide-react';

/**
 * Auto-rendered entity detail page for a single document.
 */
export function EntityDetailPage() {
  const { storeName, key } = useParams<{ storeName: string; key: string }>();
  const navigate = useNavigate();
  const { stores } = useRuntimeManifest();

  const store = stores.find((s) => s.name === storeName);
  const { document, meta, history, isLoading, error } = useStore(storeName ?? '', {
    key: key ?? '',
    refreshInterval: 15000,
  });

  if (!store) {
    return (
      <div className="flex items-center justify-center h-full text-gray-400 text-sm">
        Store &ldquo;{storeName}&rdquo; not found.
      </div>
    );
  }

  return (
    <div className="max-w-[900px] mx-auto px-6 pt-8 pb-12">
      <button
        onClick={() => navigate(`/entities/${storeName}`)}
        className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-indigo-600 mb-5 transition-colors"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to {store.entity.name}
      </button>

      {error && (
        <div className="mb-4 p-3 rounded-md bg-red-50 border border-red-200 text-red-700 text-sm">
          {error}
        </div>
      )}

      {isLoading ? (
        <div className="flex items-center justify-center py-16 text-gray-400 text-sm">Loading...</div>
      ) : !document || !meta ? (
        <div className="flex items-center justify-center py-16 text-gray-400 text-sm">Document not found.</div>
      ) : (
        <EntityDetail
          schema={store.entity.schema}
          document={document}
          meta={meta}
          history={history}
          hasTrace={store.trace}
        />
      )}
    </div>
  );
}
