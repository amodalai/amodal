/**
 * @license
 * Copyright 2025 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import { createContext, useContext, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import type { StoreDefinitionInfo } from '@amodalai/react';

export interface RuntimeManifest {
  stores: StoreDefinitionInfo[];
  isLoading: boolean;
  error: string | null;
}

const RuntimeContext = createContext<RuntimeManifest>({
  stores: [],
  isLoading: true,
  error: null,
});

export interface RuntimeProviderProps {
  runtimeUrl: string;
  children: ReactNode;
}

/**
 * Fetches the runtime manifest (stores, pages, automations) and provides
 * it to all child components via context.
 */
export function RuntimeProvider({ runtimeUrl, children }: RuntimeProviderProps) {
  const [stores, setStores] = useState<StoreDefinitionInfo[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function fetchManifest() {
      try {
        const res = await fetch(`${runtimeUrl}/api/stores`);
        if (!res.ok) {
          throw new Error(`Failed to fetch stores: ${String(res.status)}`);
        }
        // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- Server response
        const body = await res.json() as { stores: StoreDefinitionInfo[] };
        if (!cancelled) {
          setStores(body.stores);
          setError(null);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load manifest');
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    }

    void fetchManifest();
    return () => { cancelled = true; };
  }, [runtimeUrl]);

  return (
    <RuntimeContext.Provider value={{ stores, isLoading, error }}>
      {children}
    </RuntimeContext.Provider>
  );
}

export function useRuntimeManifest(): RuntimeManifest {
  return useContext(RuntimeContext);
}
