/**
 * @license
 * Copyright 2025 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import { useState, useEffect, useCallback, useRef } from 'react';

interface DeployConfig {
  appId: string;
  deployId: string;
  authMode: 'public' | 'user_auth';
  appName: string;
}

interface HostedConfig {
  appId: string;
  getToken: (() => Promise<string>) | undefined;
  loading: boolean;
  error: string | null;
}

/**
 * Reads the deploy ID from window.__DEPLOY_ID__ (injected by the hosted runtime)
 * or returns null for local dev.
 */
function getDeployId(): string | null {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- window global injected by hosted runtime
  const w = window as unknown as { __DEPLOY_ID__?: string };
  return w.__DEPLOY_ID__ ?? null;
}

/**
 * Creates a token getter that fetches and caches platform JWTs.
 *
 * - Public mode: POST /auth/token/public (no session needed)
 * - User auth mode: POST /auth/token (uses httpOnly session cookie)
 */
function createTokenGetter(appId: string, authMode: 'public' | 'user_auth'): () => Promise<string> {
  let token: string | null = null;
  let expiresAt = 0;

  const refreshUrl = authMode === 'public' ? '/auth/token/public' : '/auth/token';

  return async () => {
    if (token && Date.now() < expiresAt) return token;

    const res = await fetch(refreshUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ appId }),
    });

    if (!res.ok) {
      if (authMode === 'user_auth' && res.status === 401) {
        // Session expired — reload to show login page
        window.location.reload();
      }
      throw new Error(`Token fetch failed: ${res.status}`);
    }

    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- known API response shape
    const data = (await res.json()) as { token: string; expires_at?: string };
    token = data.token;
    expiresAt = data.expires_at
      ? new Date(data.expires_at).getTime() - 60_000 // refresh 1min before expiry
      : Date.now() + 50 * 60 * 1000;

    return token;
  };
}

/**
 * Hook that bootstraps a hosted runtime app:
 * 1. Reads deploy_id from window.__DEPLOY_ID__
 * 2. Fetches deploy config from platform API
 * 3. Sets up token acquisition based on auth mode
 *
 * Returns { appId, getToken, loading, error } for use with AmodalProvider.
 * For local dev (no deploy_id), returns appId='local' with no token.
 */
export function useHostedConfig(): HostedConfig {
  const [config, setConfig] = useState<DeployConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const tokenGetterRef = useRef<(() => Promise<string>) | undefined>(undefined);

  useEffect(() => {
    const deployId = getDeployId();

    if (!deployId) {
      // Local dev — no deploy, no auth
      setLoading(false);
      return;
    }

    let cancelled = false;

    async function bootstrap() {
      try {
        // Fetch deploy config from platform API
        const res = await fetch(`/api/deploys/${encodeURIComponent(deployId!)}/config`);
        if (!res.ok) {
          throw new Error(`Deploy config fetch failed: ${res.status}`);
        }
        // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- known API response shape
        const data = (await res.json()) as DeployConfig;

        if (cancelled) return;

        // Set up token getter based on auth mode
        tokenGetterRef.current = createTokenGetter(data.appId, data.authMode);

        // Pre-fetch the initial token
        try {
          await tokenGetterRef.current();
        } catch {
          // For user_auth, the token getter may reload on 401
          // For public, this is a real error
          if (data.authMode === 'public') {
            throw new Error('Failed to acquire initial token');
          }
        }

        if (!cancelled) {
          setConfig(data);
          setLoading(false);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load config');
          setLoading(false);
        }
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
    appId: config?.appId ?? 'local',
    getToken: tokenGetterRef.current ? getToken : undefined,
    loading,
    error,
  };
}
