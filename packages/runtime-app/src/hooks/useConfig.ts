/**
 * @license
 * Copyright 2025 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import { useState, useEffect } from 'react';

interface AppConfig {
  appId: string;
  loading: boolean;
  error: string | null;
}

/**
 * Fetches /api/config to get the app context.
 *
 * Both local dev and hosted runtime serve this endpoint.
 * Auth is handled server-side via cookies — the SPA doesn't manage tokens.
 */
export function useConfig(): AppConfig {
  const [appId, setAppId] = useState('local');
  const [loading, setLoading] = useState(true);
  const [error] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    fetch('/api/config')
      .then((res) => (res.ok ? res.json() : null))
      .then((data: unknown) => {
        if (cancelled) return;
        if (data && typeof data === 'object' && 'appId' in data) {
          setAppId(String((data as Record<string, unknown>)['appId']));
        }
        setLoading(false);
      })
      .catch(() => {
        if (!cancelled) setLoading(false);
      });

    return () => { cancelled = true; };
  }, []);

  return { appId, loading, error };
}
