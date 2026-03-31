/**
 * @license
 * Copyright 2025 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import { createContext, useContext, useMemo } from 'react';
import type { ReactNode } from 'react';
import { RuntimeClient } from './client/runtime-client';

export interface AmodalProviderProps {
  /** Base URL of the Amodal runtime server (e.g., "http://localhost:3001"). */
  runtimeUrl: string;
  /** App identifier sent in every request body. */
  appId: string;
  /** Optional async token getter for auth headers. */
  getToken?: () => string | Promise<string> | null | undefined;
  children: ReactNode;
}

interface AmodalContextValue {
  client: RuntimeClient;
  runtimeUrl: string;
  appId: string;
}

const AmodalContext = createContext<AmodalContextValue | null>(null);

/**
 * Provides a RuntimeClient to all child hooks and components.
 */
export function AmodalProvider({ runtimeUrl, appId, getToken, children }: AmodalProviderProps) {
  const client = useMemo(
    () => new RuntimeClient({ runtimeUrl, appId, getToken }),
    [runtimeUrl, appId, getToken],
  );

  const value = useMemo(
    () => ({ client, runtimeUrl, appId }),
    [client, runtimeUrl, appId],
  );

  return <AmodalContext.Provider value={value}>{children}</AmodalContext.Provider>;
}

/**
 * Access the RuntimeClient and config from the nearest AmodalProvider.
 * Throws if called outside of an AmodalProvider.
 */
export function useAmodalContext(): AmodalContextValue {
  const ctx = useContext(AmodalContext);
  if (!ctx) {
    throw new Error('useAmodalContext must be used within an <AmodalProvider>');
  }
  return ctx;
}
