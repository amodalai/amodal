/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

/**
 * StudioContext — provides the Studio URL (and admin agent URL) to all
 * hooks and components in the runtime-app.
 *
 * On mount, fetches `GET /api/context` from the runtime (same origin) to
 * discover where the Studio service lives. The hook and components that
 * need to talk to Studio read the URL from this context instead of
 * hard-coding a path or origin.
 */

import { createContext, useContext, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { createLogger } from '../utils/log';

// ---------------------------------------------------------------------------
// Route constant
// ---------------------------------------------------------------------------

const CONTEXT_ENDPOINT = '/api/context' as const;
const CONTEXT_FETCH_TIMEOUT_MS = 5_000;

/** Type guard for plain-object shapes used when parsing server JSON. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

// ---------------------------------------------------------------------------
// Context shape
// ---------------------------------------------------------------------------

export interface StudioContextValue {
  /** Base URL of the Studio service, or null if not configured / still loading. */
  studioUrl: string | null;
  /** Base URL of the admin agent service, or null if not configured / still loading. */
  adminAgentUrl: string | null;
  /** True while the initial /api/context fetch is in flight. */
  loading: boolean;
}

const StudioContext = createContext<StudioContextValue>({
  studioUrl: null,
  adminAgentUrl: null,
  loading: true,
});

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

const log = createLogger('StudioContext');

export function StudioProvider({ children }: { children: ReactNode }) {
  const [studioUrl, setStudioUrl] = useState<string | null>(null);
  const [adminAgentUrl, setAdminAgentUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), CONTEXT_FETCH_TIMEOUT_MS);

    void (async () => {
      try {
        const res = await fetch(CONTEXT_ENDPOINT, {
          signal: controller.signal,
        });
        if (!res.ok) {
          log.warn('context_fetch_failed', { status: res.status });
          return;
        }
        const body: unknown = await res.json();
        if (isRecord(body)) {
          const studioValue: unknown = body['studioUrl'];
          const adminValue: unknown = body['adminAgentUrl'];
          if (typeof studioValue === 'string') {
            setStudioUrl(studioValue);
          }
          if (typeof adminValue === 'string') {
            setAdminAgentUrl(adminValue);
          }
        }
      } catch (err: unknown) {
        if (err instanceof DOMException && err.name === 'AbortError') {
          return;
        }
        log.warn('context_fetch_error', {
          error: err instanceof Error ? err.message : String(err),
        });
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      }
    })();

    return () => {
      clearTimeout(timeoutId);
      controller.abort();
    };
  }, []);

  return (
    <StudioContext.Provider value={{ studioUrl, adminAgentUrl, loading }}>
      {children}
    </StudioContext.Provider>
  );
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useStudioContext(): StudioContextValue {
  return useContext(StudioContext);
}
