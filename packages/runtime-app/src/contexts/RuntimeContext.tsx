/**
 * @license
 * Copyright 2025 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import { createContext, useContext, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import type { StoreDefinitionInfo } from '@amodalai/react';

export interface RuntimeManifest {
  name: string;
  stores: StoreDefinitionInfo[];
  connections: string[];
  skills: string[];
  automations: string[];
  knowledge: string[];
  isLoading: boolean;
  error: string | null;
}

const RuntimeContext = createContext<RuntimeManifest>({
  name: '',
  stores: [],
  connections: [],
  skills: [],
  automations: [],
  knowledge: [],
  isLoading: true,
  error: null,
});

export interface RuntimeProviderProps {
  runtimeUrl: string;
  children: ReactNode;
}

export function RuntimeProvider({ runtimeUrl, children }: RuntimeProviderProps) {
  const [state, setState] = useState<RuntimeManifest>({
    name: '',
    stores: [],
    connections: [],
    skills: [],
    automations: [],
    knowledge: [],
    isLoading: true,
    error: null,
  });

  useEffect(() => {
    let cancelled = false;

    async function fetchManifest() {
      try {
        const inspectRes = await fetch(`${runtimeUrl}/inspect/context`);
        let connections: string[] = [];
        let skills: string[] = [];
        let automations: string[] = [];
        let knowledge: string[] = [];
        if (inspectRes.ok) {
          // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- Server response
          const inspect = await inspectRes.json() as {
            connections?: string[];
            skills?: string[];
            automations?: string[];
            knowledge?: string[];
          };
          connections = inspect.connections ?? [];
          skills = inspect.skills ?? [];
          automations = inspect.automations ?? [];
          knowledge = inspect.knowledge ?? [];
        }

        let stores: StoreDefinitionInfo[] = [];
        try {
          const storesRes = await fetch(`${runtimeUrl}/api/stores`);
          if (storesRes.ok) {
            // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- Server response
            const body = await storesRes.json() as { stores: StoreDefinitionInfo[] };
            stores = body.stores;
          }
        } catch { /* stores endpoint may not exist */ }

        if (!cancelled) {
          setState({
            name: '',
            stores,
            connections,
            skills,
            automations,
            knowledge,
            isLoading: false,
            error: null,
          });
        }
      } catch (err) {
        if (!cancelled) {
          setState((prev) => ({
            ...prev,
            isLoading: false,
            error: err instanceof Error ? err.message : 'Failed to load manifest',
          }));
        }
      }
    }

    void fetchManifest();
    return () => { cancelled = true; };
  }, [runtimeUrl]);

  return (
    <RuntimeContext.Provider value={state}>
      {children}
    </RuntimeContext.Provider>
  );
}

export function useRuntimeManifest(): RuntimeManifest {
  return useContext(RuntimeContext);
}
