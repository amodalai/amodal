/**
 * @license
 * Copyright 2025 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import { createContext, useContext, useMemo } from 'react';
import type { ReactNode } from 'react';
import type { StoreDefinitionInfo } from '@amodalai/react';
import { useQueryClient } from '@tanstack/react-query';
import { useRuntimeEvents } from './RuntimeEventsContext';
import { useRuntimeContext, useRuntimeConfig, useStores } from '@/hooks/useRuntimeData';

export interface ConnectionStatus {
  name: string;
  status: 'connected' | 'error' | 'unknown';
  error?: string;
}

export interface McpServerStatus {
  name: string;
  status: 'connected' | 'connecting' | 'disconnected' | 'error';
  toolCount: number;
  error?: string;
}

export interface RuntimeManifest {
  name: string;
  model: string;
  provider: string;
  stores: StoreDefinitionInfo[];
  connections: ConnectionStatus[];
  mcpServers: McpServerStatus[];
  skills: string[];
  automations: string[];
  knowledge: string[];
  resumeSessionId: string | null;
  isLoading: boolean;
  error: string | null;
}

const RuntimeContextValue = createContext<RuntimeManifest>({
  name: '',
  model: '',
  provider: '',
  stores: [],
  connections: [],
  mcpServers: [],
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
  const queryClient = useQueryClient();

  const { data: ctx, isLoading: ctxLoading, error: ctxError } = useRuntimeContext(runtimeUrl);
  const { data: config } = useRuntimeConfig(runtimeUrl);
  const { data: storesList } = useStores(runtimeUrl);

  // Refetch when runtime signals changes
  useRuntimeEvents(['manifest_changed'], () => {
    void queryClient.invalidateQueries({ queryKey: ['runtime-context'] });
    void queryClient.invalidateQueries({ queryKey: ['runtime-config'] });
    void queryClient.invalidateQueries({ queryKey: ['stores'] });
  });

  const resumeSessionId = config && typeof config === 'object' && 'resumeSessionId' in config
    ? String(config['resumeSessionId'] ?? '') || null : null;

  const value: RuntimeManifest = useMemo(() => ({
    name: ctx?.name ?? '',
    model: ctx?.model ?? '',
    provider: ctx?.provider ?? '',
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- compatible store shape
    stores: (storesList ?? []) as unknown as StoreDefinitionInfo[],
    connections: ctx?.connections ?? [],
    mcpServers: ctx?.mcpServers ?? [],
    skills: ctx?.skills ?? [],
    automations: ctx?.automations ?? [],
    knowledge: ctx?.knowledge ?? [],
    resumeSessionId,
    isLoading: ctxLoading,
    error: ctxError ? (ctxError instanceof Error ? ctxError.message : 'Failed to load manifest') : null,
  }), [ctx, resumeSessionId, storesList, ctxLoading, ctxError]);

  return (
    <RuntimeContextValue.Provider value={value}>
      {children}
    </RuntimeContextValue.Provider>
  );
}

export function useRuntimeManifest(): RuntimeManifest {
  return useContext(RuntimeContextValue);
}
