/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import { useState, useEffect, useCallback, useRef } from 'react';

// --- Types ---

interface WorkspaceConfig {
  enabled: true;
  baseCommitSha: string;
  baseBranchName: string;
  platformApiUrl: string;
  appId: string;
}

interface WorkspaceCommit {
  sha: string;
  message: string;
  files: string[];
  timestamp: string;
}

interface WorkspaceResponse {
  commit: WorkspaceCommit;
  bundle: string;
  commits: WorkspaceCommit[];
}

interface StoredWorkspace {
  baseCommitSha: string;
  baseBranchName: string;
  headSha: string;
  bundle: string;
  commits: WorkspaceCommit[];
  persistedBranchName?: string;
  lastModified: string;
}

interface PersistResult {
  branch: string;
  headCommit: string;
  commitCount: number;
}

export interface WorkspaceState {
  /** Whether there are unpersisted commits. */
  isDirty: boolean;
  /** Stored workspace state from localStorage. */
  stored: StoredWorkspace | null;
  /** Branch name if changes have been persisted at least once. */
  persistedBranch: string | null;
  /** Whether workspace is locked by another tab. */
  lockedByOtherTab: boolean;
  /** Whether the stored workspace base is stale (deploy has changed). */
  isStale: boolean;
  /** Warning message (e.g. bundle size). */
  warning: string | null;
  /** Called after each PUT /api/files response that includes workspace data. */
  onFileSaved: (workspace: WorkspaceResponse) => void;
  /** Restore workspace on reconnect (sends stored bundle to runtime). */
  restore: () => Promise<void>;
  /** Persist changes to platform API (creates or updates branch). */
  persist: () => Promise<PersistResult>;
  /** Discard all changes. */
  discard: () => Promise<void>;
}

/** Bundle size threshold (4MB in base64) above which we show a warning. */
const BUNDLE_SIZE_WARNING_BYTES = 4 * 1024 * 1024;

// --- Storage helpers ---

function getStorageKey(appId: string): string {
  return `amodal:workspace:${appId}`;
}

function getStoredWorkspace(storageKey: string): StoredWorkspace | null {
  try {
    const raw = localStorage.getItem(storageKey);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && 'baseCommitSha' in parsed) {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- shape validated above
      return parsed as StoredWorkspace;
    }
    return null;
  } catch {
    return null;
  }
}

function saveToLocalStorage(storageKey: string, data: StoredWorkspace): void {
  try {
    localStorage.setItem(storageKey, JSON.stringify(data));
  } catch {
    // localStorage full or unavailable — silently fail
  }
}

function clearLocalStorage(storageKey: string): void {
  try {
    localStorage.removeItem(storageKey);
  } catch {
    // silently fail
  }
}

// --- Hook ---

/**
 * Workspace hook for git-based editing in hosted mode.
 * Returns null when not in hosted mode (workspace.enabled is falsy).
 *
 * Lives in the OSS runtime-app package but is inert in local mode.
 */
export function useWorkspace(): WorkspaceState | null {
  const [wsConfig, setWsConfig] = useState<WorkspaceConfig | null>(null);
  const [stored, setStored] = useState<StoredWorkspace | null>(null);
  const [lockedByOtherTab, setLockedByOtherTab] = useState(false);
  const configFetched = useRef(false);
  const wsConfigRef = useRef<WorkspaceConfig | null>(null);
  const channelRef = useRef<BroadcastChannel | null>(null);

  // Keep ref in sync so callbacks always have latest config
  useEffect(() => {
    wsConfigRef.current = wsConfig;
  }, [wsConfig]);

  // Fetch workspace config on mount, then restore from localStorage if needed.
  // This ensures pending changes survive Fly machine cold starts.
  useEffect(() => {
    if (configFetched.current) return;
    configFetched.current = true;

    fetch('/api/config')
      .then((res) => res.json())
      .then((data: unknown) => {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- validated below
        const obj = data && typeof data === 'object' ? data as Record<string, unknown> : {};
        const ws = obj['workspace'];
        if (ws && typeof ws === 'object' && 'enabled' in ws) {
          // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- shape validated above
          const wsConf = ws as WorkspaceConfig;
          if (!wsConf.enabled) return;
          if (!wsConf.appId || !wsConf.platformApiUrl) return;
          setWsConfig(wsConf);
          wsConfigRef.current = wsConf;
          const key = getStorageKey(wsConf.appId);
          const existing = getStoredWorkspace(key);
          setStored(existing);

          // If localStorage has a pending bundle, restore it to the runtime.
          // The server is idempotent — if /tmp/workspace already matches, it skips.
          if (existing?.bundle && existing?.headSha) {
            void fetch('/api/workspace/restore', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ bundle: existing.bundle, headSha: existing.headSha }),
            }).catch(() => {
              // Restore failed — edits are still in localStorage for next attempt
            });
          }
        }
      })
      .catch(() => {
        // Not in hosted mode or config unavailable
      });
  }, []);

  // Multi-tab detection via BroadcastChannel
  useEffect(() => {
    if (!wsConfig) return;

    try {
      const channel = new BroadcastChannel(`amodal:workspace:${wsConfig.appId}`);
      channelRef.current = channel;

      // Announce this tab is active
      channel.postMessage({ type: 'tab-active' });

      channel.onmessage = (event: MessageEvent<{ type: string }>) => {
        if (event.data?.type === 'tab-active') {
          // Another tab announced itself — warn this tab
          setLockedByOtherTab(true);
        } else if (event.data?.type === 'tab-closed') {
          setLockedByOtherTab(false);
        } else if (event.data?.type === 'workspace-updated') {
          // Another tab saved — refresh our stored state
          const key = getStorageKey(wsConfig.appId);
          setStored(getStoredWorkspace(key));
        }
      };

      return () => {
        channel.postMessage({ type: 'tab-closed' });
        channel.close();
        channelRef.current = null;
      };
    } catch {
      // BroadcastChannel not available (e.g. older browsers)
    }
  }, [wsConfig]);

  const onFileSaved = useCallback(
    (workspace: WorkspaceResponse) => {
      const cfg = wsConfigRef.current;
      if (!cfg) return;
      const key = getStorageKey(cfg.appId);
      const current = getStoredWorkspace(key);

      const updated: StoredWorkspace = {
        baseCommitSha: current?.baseCommitSha ?? cfg.baseCommitSha,
        baseBranchName: cfg.baseBranchName,
        headSha: workspace.commit.sha,
        bundle: workspace.bundle,
        commits: workspace.commits,
        persistedBranchName: current?.persistedBranchName,
        lastModified: new Date().toISOString(),
      };

      saveToLocalStorage(key, updated);
      setStored(updated);

      // Notify other tabs
      channelRef.current?.postMessage({ type: 'workspace-updated' });
    },
    [],
  );

  const restore = useCallback(async () => {
    if (!wsConfig) return;
    const key = getStorageKey(wsConfig.appId);
    const current = getStoredWorkspace(key);
    if (!current?.bundle || !current?.headSha) return;

    const res = await fetch('/api/workspace/restore', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ bundle: current.bundle, headSha: current.headSha }),
    });

    if (res.status === 409) {
      // Deploy has changed since these edits were made — stored workspace is stale.
      // The UI should prompt the user to discard.
      // We don't auto-discard to avoid data loss.
    }
  }, [wsConfig]);

  const persist = useCallback(async (): Promise<PersistResult> => {
    if (!wsConfig) throw new Error('No workspace config');
    const key = getStorageKey(wsConfig.appId);
    const current = getStoredWorkspace(key);
    if (!current?.bundle) throw new Error('No changes to persist');

    const branchName =
      current.persistedBranchName ?? `config/${wsConfig.appId}-${Date.now()}`;

    const res = await fetch(
      `${wsConfig.platformApiUrl}/api/repos/${wsConfig.appId}/import-bundle`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          baseCommit: current.baseCommitSha,
          bundle: current.bundle,
          branchName,
        }),
      },
    );

    if (!res.ok) {
      const errBody: unknown = await res.json().catch(() => ({}));
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- error response parsing
      const errObj = errBody && typeof errBody === 'object' ? errBody as Record<string, unknown> : {};
      throw new Error(String(errObj['message'] ?? `Persist failed: ${res.status}`));
    }

    const body: unknown = await res.json();
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- platform API response
    const data = body as PersistResult;

    // Re-anchor: persisted HEAD becomes the new base
    const updated: StoredWorkspace = {
      baseCommitSha: data.headCommit,
      baseBranchName: current.baseBranchName,
      headSha: data.headCommit,
      bundle: '',
      commits: [],
      persistedBranchName: data.branch,
      lastModified: new Date().toISOString(),
    };
    saveToLocalStorage(key, updated);
    setStored(updated);

    return data;
  }, [wsConfig]);

  const discard = useCallback(async () => {
    if (!wsConfig) return;

    await fetch('/api/workspace/reset', { method: 'POST' }).catch(() => {});

    const key = getStorageKey(wsConfig.appId);
    clearLocalStorage(key);
    setStored(null);
  }, [wsConfig]);

  // Stale detection: stored workspace base doesn't match current deploy
  const isStale = !!(
    wsConfig &&
    stored?.baseCommitSha &&
    stored.baseCommitSha !== wsConfig.baseCommitSha &&
    !stored.persistedBranchName // only stale if not yet persisted (persisted changes re-anchor base)
  );

  // Bundle size warning
  const bundleSize = stored?.bundle?.length ?? 0;
  const warning =
    bundleSize > BUNDLE_SIZE_WARNING_BYTES
      ? `Bundle is ${(bundleSize / 1024 / 1024).toFixed(1)}MB — consider persisting to avoid localStorage limits.`
      : null;

  // Always return the object so onFileSaved is available even before
  // the async config fetch completes. isDirty gates on wsConfig so
  // the WorkspaceBar won't render prematurely in local/OSS mode.
  return {
    isDirty: !!wsConfig && (stored?.commits?.length ?? 0) > 0,
    stored,
    persistedBranch: stored?.persistedBranchName ?? null,
    lockedByOtherTab,
    isStale,
    warning,
    onFileSaved,
    restore,
    persist,
    discard,
  };
}
