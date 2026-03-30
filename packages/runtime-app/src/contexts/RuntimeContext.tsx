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
  model: string;
  provider: string;
  stores: StoreDefinitionInfo[];
  connections: string[];
  skills: string[];
  automations: string[];
  knowledge: string[];
  resumeSessionId: string | null;
  isLoading: boolean;
  error: string | null;
}

const RuntimeContext = createContext<RuntimeManifest>({
  name: '',
  model: '',
  provider: '',
  stores: [],
  connections: [],
  skills: [],
  automations: [],
  knowledge: [],
  resumeSessionId: null,
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
    model: '',
    provider: '',
    stores: [],
    connections: [],
    skills: [],
    automations: [],
    knowledge: [],
    resumeSessionId: null,
    isLoading: true,
    error: null,
  });

  useEffect(() => {
    let cancelled = false;

    async function fetchManifest() {
      try {
        const inspectRes = await fetch(`${runtimeUrl}/inspect/context`);
        let agentName = '';
        let model = '';
        let provider = '';
        let connections: string[] = [];
        let skills: string[] = [];
        let automations: string[] = [];
        let knowledge: string[] = [];
        if (inspectRes.ok) {
          // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- Server response
          const inspect = await inspectRes.json() as {
            name?: string;
            model?: string;
            provider?: string;
            connections?: string[];
            skills?: string[];
            automations?: string[];
            knowledge?: string[];
          };
          agentName = inspect.name ?? '';
          model = inspect.model ?? '';
          provider = inspect.provider ?? '';
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

        // Fetch server config (resume session ID)
        let resumeSessionId: string | null = null;
        try {
          const configRes = await fetch(`${runtimeUrl}/config`);
          if (configRes.ok) {
            // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- Server response
            const configBody = await configRes.json() as { resumeSessionId?: string | null };
            resumeSessionId = configBody.resumeSessionId ?? null;
          }
        } catch { /* config endpoint may not exist */ }

        if (!cancelled) {
          setState({
            name: agentName,
            model,
            provider,
            stores,
            connections,
            skills,
            automations,
            knowledge,
            resumeSessionId,
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
