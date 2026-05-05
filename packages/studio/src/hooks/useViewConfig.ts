/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import { useCallback, useEffect, useState } from 'react';

/**
 * "View config" power-user toggle. When OFF (default), Studio hides the
 * lower-level configuration surfaces from the sidebar. Power users / ISVs
 * flip the toggle to bring the config surface back.
 *
 * State lives in localStorage so it survives reloads. A storage event
 * listener keeps multiple tabs in sync.
 */

const STORAGE_KEY = 'amodal-studio-view-config-v1';
const STORAGE_EVENT = 'amodal-studio-view-config-change';

function readStoredValue(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.localStorage.getItem(STORAGE_KEY) === 'true';
  } catch {
    return false;
  }
}

export function useViewConfig(): {
  viewConfig: boolean;
  setViewConfig: (next: boolean) => void;
} {
  const [viewConfig, setViewConfigState] = useState<boolean>(() => readStoredValue());

  useEffect(() => {
    const refresh = () => setViewConfigState(readStoredValue());
    window.addEventListener('storage', refresh);
    window.addEventListener(STORAGE_EVENT, refresh);
    return () => {
      window.removeEventListener('storage', refresh);
      window.removeEventListener(STORAGE_EVENT, refresh);
    };
  }, []);

  const setViewConfig = useCallback((next: boolean) => {
    try {
      window.localStorage.setItem(STORAGE_KEY, next ? 'true' : 'false');
      window.dispatchEvent(new Event(STORAGE_EVENT));
    } catch {
      // Private browsing / quota exceeded — at least update local state.
    }
    setViewConfigState(next);
  }, []);

  return { viewConfig, setViewConfig };
}
