/**
 * @license
 * Copyright 2025 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import { useState, useEffect, useCallback, useRef } from 'react';

export type AuthStatus = 'loading' | 'authenticated' | 'unauthenticated' | 'none';

export interface AuthState {
  /** Current token string, null if not authenticated or not needed */
  token: string | null;
  /** Auth status: loading, authenticated, unauthenticated (login required), none (local dev) */
  status: AuthStatus;
  /** Async token getter for AmodalProvider (handles refresh) */
  getToken: (() => Promise<string>) | undefined;
  /** Login with email/password. Returns { ok, error? }. On success, auto-retries token bootstrap. */
  login: (email: string, password: string) => Promise<{ ok: boolean; error?: string }>;
  /** Re-run the token bootstrap (e.g. after login sets a session cookie). */
  retry: () => void;
}

/**
 * Tries to acquire a token from /auth/token on mount.
 *
 * Status transitions:
 * - loading → none: /auth/token 404'd (local dev, no auth)
 * - loading → authenticated: got a token (cloud, public or logged-in)
 * - loading → unauthenticated: /auth/token 401'd (cloud, login required)
 */
export function useAuth(): AuthState {
  const [status, setStatus] = useState<AuthStatus>('loading');
  const [token, setToken] = useState<string | null>(null);
  const [retryKey, setRetryKey] = useState(0);
  const tokenGetterRef = useRef<(() => Promise<string>) | undefined>(undefined);
  useEffect(() => {
    let cancelled = false;
    // Only show loading on explicit retry — not on initial mount or strict-mode re-mount
    if (retryKey > 0) setStatus('loading');
    tokenGetterRef.current = undefined;

    async function bootstrap() {
      try {
        const res = await fetch('/auth/token', { method: 'POST', credentials: 'include' });

        if (res.status === 404) {
          if (!cancelled) {
            setToken('local');
            setStatus('none');
          }
          return;
        }

        if (res.status === 401 || res.status === 403) {
          if (!cancelled) setStatus('unauthenticated');
          return;
        }

        if (!res.ok) {
          if (!cancelled) setStatus('none');
          return;
        }

        const data: Record<string, unknown> = await res.json();
        let currentToken = String(data['token'] ?? '');

        if (!currentToken) {
          if (!cancelled) setStatus('none');
          return;
        }

        let expiresAt = data['expires_at']
          ? new Date(String(data['expires_at'])).getTime() - 60_000
          : Date.now() + 50 * 60 * 1000;

        const scheduleRefresh = (ms: number) => {
          if (ms > 0) setTimeout(() => {
            // Token expired — clear it so queries pause, then refresh.
            setToken(null);
            void tokenGetterRef.current?.();
          }, ms);
        };

        tokenGetterRef.current = async () => {
          if (Date.now() < expiresAt) return currentToken;

          const refreshRes = await fetch('/auth/token', { method: 'POST', credentials: 'include' });
          if (!refreshRes.ok) {
            setStatus('unauthenticated');
            setToken(null);
            throw new Error(`Token refresh failed: ${refreshRes.status}`);
          }

          const refreshData: Record<string, unknown> = await refreshRes.json();
          currentToken = String(refreshData['token'] ?? '');
          expiresAt = refreshData['expires_at']
            ? new Date(String(refreshData['expires_at'])).getTime() - 60_000
            : Date.now() + 50 * 60 * 1000;

          setToken(currentToken);
          scheduleRefresh(expiresAt - Date.now());
          return currentToken;
        };

        if (!cancelled) {
          setToken(currentToken);
          setStatus('authenticated');
          scheduleRefresh(expiresAt - Date.now());
        }
      } catch {
        if (!cancelled) setStatus('none');
      }
    }

    void bootstrap();
    return () => { cancelled = true; };
  }, [retryKey]);

  const getToken = useCallback(async () => {
    if (!tokenGetterRef.current) return '';
    return tokenGetterRef.current();
  }, []);

  const retry = useCallback(() => {
    setRetryKey((k) => k + 1);
  }, []);

  const login = useCallback(async (email: string, password: string): Promise<{ ok: boolean; error?: string }> => {
    try {
      const res = await fetch('/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ email, password }),
      });

      if (!res.ok) {
        const body: Record<string, unknown> = await res.json().catch(() => ({}));
        return { ok: false, error: String(body['error'] ?? 'Login failed') };
      }

      // Login sets session cookie — re-bootstrap to get the JWT
      setRetryKey((k) => k + 1);
      return { ok: true };
    } catch {
      return { ok: false, error: 'Network error' };
    }
  }, []);

  return {
    token,
    status,
    getToken: tokenGetterRef.current ? getToken : undefined,
    login,
    retry,
  };
}
