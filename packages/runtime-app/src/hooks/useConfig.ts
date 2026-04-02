/**
 * @license
 * Copyright 2025 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import { useState, useEffect, useCallback, useRef } from 'react';

interface AppConfig {
  getToken: (() => Promise<string>) | undefined;
  loading: boolean;
  error: string | null;
}

/**
 * Tries to acquire a token from /auth/token on mount.
 *
 * - Hosted: /auth/token returns a JWT → SPA sends it on requests
 * - Local dev: /auth/token 404s → no token, no auth headers
 */
export function useConfig(): AppConfig {
  const [loading, setLoading] = useState(true);
  const [error] = useState<string | null>(null);
  const tokenGetterRef = useRef<(() => Promise<string>) | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;

    async function bootstrap() {
      try {
        const res = await fetch('/auth/token', { method: 'POST', credentials: 'include' });

        if (!res.ok) {
          // No auth endpoint (local dev) or not logged in — proceed without token
          setLoading(false);
          return;
        }

        const data: Record<string, unknown> = await res.json();
        let token = String(data['token'] ?? '');

        if (!token) {
          // Empty token — local dev, no auth needed
          setLoading(false);
          return;
        }
        let expiresAt = data['expires_at']
          ? new Date(String(data['expires_at'])).getTime() - 60_000
          : Date.now() + 50 * 60 * 1000;

        tokenGetterRef.current = async () => {
          if (Date.now() < expiresAt) return token;

          const refreshRes = await fetch('/auth/token', { method: 'POST', credentials: 'include' });
          if (!refreshRes.ok) throw new Error(`Token refresh failed: ${refreshRes.status}`);

          const refreshData: Record<string, unknown> = await refreshRes.json();
          token = String(refreshData['token'] ?? '');
          expiresAt = refreshData['expires_at']
            ? new Date(String(refreshData['expires_at'])).getTime() - 60_000
            : Date.now() + 50 * 60 * 1000;

          return token;
        };

        if (!cancelled) setLoading(false);
      } catch {
        if (!cancelled) setLoading(false);
      }
    }

    void bootstrap();
    return () => { cancelled = true; };
  }, []);

  const getToken = useCallback(async () => {
    if (!tokenGetterRef.current) return '';
    return tokenGetterRef.current();
  }, []);

  return {
    getToken: tokenGetterRef.current ? getToken : undefined,
    loading,
    error,
  };
}
