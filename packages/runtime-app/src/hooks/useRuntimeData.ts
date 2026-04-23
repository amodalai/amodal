/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import { useQuery } from '@tanstack/react-query';
import { useAuthContext } from '@/App';

function authHeaders(token: string | null): Record<string, string> {
  return token ? { Authorization: `Bearer ${token}` } : {};
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

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

export interface StoreDefinition {
  name: string;
  type?: string;
}

export interface RuntimeContext {
  name: string;
  model: string;
  provider: string;
  stores: StoreDefinition[];
  connections: ConnectionStatus[];
  mcpServers: McpServerStatus[];
  skills: string[];
  automations: string[];
  knowledge: string[];
  nodeVersion?: string;
  runtimeVersion?: string;
  studioUrl?: string;
  uptime?: number;
}

export interface PageConfig {
  name: string;
  filePath?: string;
  hidden?: boolean;
}

// ---------------------------------------------------------------------------
// Hooks
// ---------------------------------------------------------------------------

/**
 * Fetch runtime context from /inspect/context.
 * Returns agent name, model, connections, stores, etc.
 */
export function useRuntimeContext(runtimeUrl: string) {
  const { token } = useAuthContext();
  const enabled = !!token;

  return useQuery({
    queryKey: ['runtime-context', runtimeUrl],
    queryFn: async (): Promise<RuntimeContext | null> => {

      const res = await fetch(`${runtimeUrl}/inspect/context`, {
        headers: authHeaders(token),
        signal: AbortSignal.timeout(5_000),
      });
      if (!res.ok) return null;
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- Server response
      return (await res.json()) as RuntimeContext;
    },
    enabled,
    placeholderData: null,
  });
}

/**
 * Fetch runtime config from /config.
 */
export function useRuntimeConfig(runtimeUrl: string) {
  const { token } = useAuthContext();
  const enabled = !!token;

  return useQuery({
    queryKey: ['runtime-config', runtimeUrl],
    queryFn: async (): Promise<Record<string, unknown> | null> => {

      const res = await fetch(`${runtimeUrl}/config`, {
        headers: authHeaders(token),
        signal: AbortSignal.timeout(5_000),
      });
      if (!res.ok) return null;
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- Server response
      return (await res.json()) as Record<string, unknown>;
    },
    enabled,
    placeholderData: null,
  });
}

/**
 * Fetch stores from /api/stores.
 */
export function useStores(runtimeUrl: string) {
  const { token } = useAuthContext();
  const enabled = !!token;

  return useQuery({
    queryKey: ['stores', runtimeUrl],
    queryFn: async (): Promise<StoreDefinition[]> => {

      const res = await fetch(`${runtimeUrl}/api/stores`, {
        headers: authHeaders(token),
        signal: AbortSignal.timeout(5_000),
      });
      if (!res.ok) return [];
      const data: unknown = await res.json();
      if (!Array.isArray(data)) return [];
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- Server response
      return data as StoreDefinition[];
    },
    enabled,
    placeholderData: [],
  });
}

/**
 * Fetch pages from /api/pages (hosted) or fall back to Vite virtual module (local dev).
 */
export function usePages() {
  const { token } = useAuthContext();
  const enabled = !!token;

  return useQuery({
    queryKey: ['pages'],
    queryFn: async (): Promise<PageConfig[]> => {

      // Try API first (works with pre-built pages in hosted mode)
      try {
        const res = await fetch('/api/pages', { headers: authHeaders(token) });
        if (res.ok) {
          const data: unknown = await res.json();
          if (data && typeof data === 'object' && 'pages' in data && Array.isArray((data as Record<string, unknown>)['pages'])) {
            // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- Server response
            return (data as Record<string, unknown>)['pages'] as PageConfig[];
          }
        }
      } catch {
        // API not available — fall through to virtual module
      }

      // Fall back to Vite virtual module (local dev inside monorepo)
      try {
        const m = await import('virtual:amodal-manifest');
         
        const pages = (m as { pages: PageConfig[] }).pages;
        return pages.filter((p) => !p.hidden);
      } catch {
        return [];
      }
    },
    enabled,
    placeholderData: [],
  });
}
