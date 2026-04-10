/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { createLogger } from '../utils/log';

const log = createLogger('useWorkspace');

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

export type WorkspaceErrorKind =
  | 'no_config'
  | 'no_changes'
  | 'storage_full'
  | 'storage_unavailable'
  | 'restore_failed'
  | 'restore_stale'
  | 'reset_failed'
  | 'persist_failed';

export class WorkspaceError extends Error {
  readonly kind: WorkspaceErrorKind;
  readonly cause?: unknown;
  constructor(kind: WorkspaceErrorKind, message: string, cause?: unknown) {
    super(message);
    this.name = 'WorkspaceError';
    this.kind = kind;
    this.cause = cause;
  }
}

export interface WorkspaceState {
  /** Whether the workspace has finished initializing (config fetched + restore complete). */
  ready: boolean;
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
  /** Warning message (e.g. bundle size, storage failure). */
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

// --- Constants ---

/** Bundle size threshold (4MB in base64) above which we show a warning. */
const BUNDLE_SIZE_WARNING_BYTES = 4 * 1024 * 1024;

/** Timeout for runtime fetch calls (config, restore, reset). */
const RUNTIME_FETCH_TIMEOUT_MS = 30_000;

/** Timeout for platform-api persist calls (slower — does git operations). */
const PERSIST_FETCH_TIMEOUT_MS = 60_000;

/** localStorage key prefix for workspace state. */
const STORAGE_KEY_PREFIX = 'amodal:workspace:';

/** BroadcastChannel message types (typed union, not raw strings at call sites). */
const TAB_MSG = {
  ACTIVE: 'tab-active',
  CLOSED: 'tab-closed',
  UPDATED: 'workspace-updated',
} as const;

type TabMessage = { type: typeof TAB_MSG[keyof typeof TAB_MSG] };

// --- Storage helpers ---

function getStorageKey(appId: string): string {
  return `${STORAGE_KEY_PREFIX}${appId}`;
}

/**
 * Read a string field from an unknown record-shaped value.
 * Returns undefined if the field is missing or not a string.
 *
 * The caller must have already narrowed `obj` to a Record-like shape.
 */
function readString(obj: Record<string, unknown>, key: string): string | undefined {
  const val = obj[key];
  return typeof val === 'string' ? val : undefined;
}

/**
 * Type guard: narrows an unknown to a record (object with string keys).
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/**
 * Validate that a parsed value matches StoredWorkspace shape.
 * Returns null if any required field is missing or wrong type.
 */
function validateStoredWorkspace(value: unknown): StoredWorkspace | null {
  if (!isRecord(value)) return null;

  const baseCommitSha = readString(value, 'baseCommitSha');
  const baseBranchName = readString(value, 'baseBranchName');
  const headSha = readString(value, 'headSha');
  const bundle = readString(value, 'bundle');
  const lastModified = readString(value, 'lastModified');
  if (
    baseCommitSha === undefined ||
    baseBranchName === undefined ||
    headSha === undefined ||
    bundle === undefined ||
    lastModified === undefined
  ) {
    return null;
  }

  const rawCommits = value['commits'];
  if (!Array.isArray(rawCommits)) return null;
  const commits: WorkspaceCommit[] = rawCommits.filter(isWorkspaceCommit);

  const persistedBranchName = readString(value, 'persistedBranchName');

  return {
    baseCommitSha,
    baseBranchName,
    headSha,
    bundle,
    commits,
    persistedBranchName,
    lastModified,
  };
}

function isWorkspaceCommit(value: unknown): value is WorkspaceCommit {
  if (!isRecord(value)) return false;
  if (readString(value, 'sha') === undefined) return false;
  if (readString(value, 'message') === undefined) return false;
  if (readString(value, 'timestamp') === undefined) return false;
  return Array.isArray(value['files']);
}

/**
 * Parse a WorkspaceConfig from an unknown value (the `workspace` field of /api/config).
 * Returns null if any required field is missing or wrong type, or if not enabled.
 */
function parseWorkspaceConfig(value: unknown): WorkspaceConfig | null {
  if (!isRecord(value)) return null;
  if (value['enabled'] !== true) return null;

  const baseCommitSha = readString(value, 'baseCommitSha');
  const baseBranchName = readString(value, 'baseBranchName');
  const platformApiUrl = readString(value, 'platformApiUrl');
  const appId = readString(value, 'appId');
  if (!baseCommitSha || !baseBranchName || !platformApiUrl || !appId) return null;

  return { enabled: true, baseCommitSha, baseBranchName, platformApiUrl, appId };
}

/**
 * Parse a PersistResult from an unknown response body.
 * Returns null if any required field is missing or wrong type.
 */
function parsePersistResult(value: unknown): PersistResult | null {
  if (!isRecord(value)) return null;
  const branch = readString(value, 'branch');
  const headCommit = readString(value, 'headCommit');
  if (!branch || !headCommit) return null;
  const commitCount = value['commitCount'];
  if (typeof commitCount !== 'number') return null;
  return { branch, headCommit, commitCount };
}

/**
 * Read a string field from an error response body.
 * Returns undefined if missing or not a string.
 */
function readErrorMessage(body: unknown): string | undefined {
  if (!isRecord(body)) return undefined;
  return readString(body, 'message');
}

function getStoredWorkspace(storageKey: string): StoredWorkspace | null {
  let raw: string | null;
  try {
    raw = localStorage.getItem(storageKey);
  } catch (err) {
    log.warn('localStorage.getItem failed', { storageKey, err });
    return null;
  }
  if (!raw) return null;
  try {
    return validateStoredWorkspace(JSON.parse(raw));
  } catch (err) {
    log.warn('failed to parse stored workspace', { storageKey, err });
    return null;
  }
}

interface SaveResult {
  ok: boolean;
  reason?: 'quota_exceeded' | 'unavailable';
}

function saveToLocalStorage(storageKey: string, data: StoredWorkspace): SaveResult {
  try {
    localStorage.setItem(storageKey, JSON.stringify(data));
    return { ok: true };
  } catch (err) {
    // Distinguish quota exceeded from other failures so callers can warn the user.
    const isQuota =
      err instanceof DOMException &&
      (err.name === 'QuotaExceededError' || err.code === 22);
    log.warn('localStorage.setItem failed', {
      storageKey,
      reason: isQuota ? 'quota_exceeded' : 'unavailable',
      err,
    });
    return { ok: false, reason: isQuota ? 'quota_exceeded' : 'unavailable' };
  }
}

function clearLocalStorage(storageKey: string): void {
  try {
    localStorage.removeItem(storageKey);
  } catch (err) {
    log.warn('localStorage.removeItem failed', { storageKey, err });
  }
}

// --- Fetch helpers ---

/**
 * Fetch with timeout and AbortSignal support.
 * Throws WorkspaceError on timeout or network failure.
 */
async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number,
  errorKind: WorkspaceErrorKind,
  errorContext: string,
): Promise<Response> {
  const signal = AbortSignal.timeout(timeoutMs);
  try {
    return await fetch(url, { ...init, signal });
  } catch (err) {
    if (err instanceof DOMException && err.name === 'TimeoutError') {
      throw new WorkspaceError(errorKind, `${errorContext}: request timed out after ${timeoutMs}ms`, err);
    }
    throw new WorkspaceError(errorKind, `${errorContext}: ${err instanceof Error ? err.message : String(err)}`, err);
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
  const [ready, setReady] = useState(false);
  const [lockedByOtherTab, setLockedByOtherTab] = useState(false);
  const [storageWarning, setStorageWarning] = useState<string | null>(null);
  const configFetched = useRef(false);
  const wsConfigRef = useRef<WorkspaceConfig | null>(null);
  const channelRef = useRef<BroadcastChannel | null>(null);
  const isMountedRef = useRef(true);

  // Track mount state so async callbacks don't setState on unmounted component.
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  // Keep ref in sync so callbacks always have latest config
  useEffect(() => {
    wsConfigRef.current = wsConfig;
  }, [wsConfig]);

  // Fetch workspace config on mount, then restore from localStorage if needed.
  // Awaits restore so `ready` is only set after the server has the edits,
  // allowing the file tree to wait and show restored files after cold start.
  useEffect(() => {
    if (configFetched.current) return;
    configFetched.current = true;

    void (async () => {
      try {
        const res = await fetchWithTimeout(
          '/api/config',
          {},
          RUNTIME_FETCH_TIMEOUT_MS,
          'restore_failed',
          'fetch /api/config',
        );
        if (!res.ok) {
          // Non-OK from /api/config means we can't determine workspace mode.
          // Treat as "not in hosted mode" — same as if the field were missing.
          log.warn('config_fetch_non_ok', { status: res.status });
          return;
        }
        const data: unknown = await res.json();
        if (!isRecord(data)) return;
        const wsConf = parseWorkspaceConfig(data['workspace']);
        if (!wsConf) return;

        if (!isMountedRef.current) return;
        setWsConfig(wsConf);
        wsConfigRef.current = wsConf;
        const key = getStorageKey(wsConf.appId);
        const existing = getStoredWorkspace(key);
        if (isMountedRef.current) setStored(existing);

        // If localStorage has a pending bundle, restore it to the runtime.
        // The server is idempotent — if workspace already matches, it skips.
        if (existing?.bundle && existing?.headSha) {
          try {
            await fetchWithTimeout(
              '/api/workspace/restore',
              {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ bundle: existing.bundle, headSha: existing.headSha }),
              },
              RUNTIME_FETCH_TIMEOUT_MS,
              'restore_failed',
              'restore on mount',
            );
          } catch (err) {
            // Restore failed — edits are still in localStorage for next attempt.
            // Surface to console; isStale will be computed independently.
            log.warn('restore on mount failed', err);
          }
        }
      } catch (err) {
        // Network error fetching /api/config — likely not in hosted mode or server unreachable.
        log.warn('failed to fetch /api/config', err);
      } finally {
        if (isMountedRef.current) setReady(true);
      }
    })();
  }, []);

  // Multi-tab detection via BroadcastChannel
  useEffect(() => {
    if (!wsConfig) return;

    if (typeof BroadcastChannel === 'undefined') {
      // Feature not available (older browsers) — multi-tab detection disabled.
      return;
    }

    const channel = new BroadcastChannel(getStorageKey(wsConfig.appId));
    channelRef.current = channel;

    // Announce this tab is active
    channel.postMessage({ type: TAB_MSG.ACTIVE } satisfies TabMessage);

    channel.onmessage = (event: MessageEvent<TabMessage>) => {
      const msg = event.data;
      if (!msg || typeof msg.type !== 'string') return;
      if (msg.type === TAB_MSG.ACTIVE) {
        setLockedByOtherTab(true);
      } else if (msg.type === TAB_MSG.CLOSED) {
        setLockedByOtherTab(false);
      } else if (msg.type === TAB_MSG.UPDATED) {
        const key = getStorageKey(wsConfig.appId);
        setStored(getStoredWorkspace(key));
      }
    };

    return () => {
      try {
        channel.postMessage({ type: TAB_MSG.CLOSED } satisfies TabMessage);
      } catch (err) {
        log.warn('failed to post tab-closed message', err);
      }
      channel.close();
      channelRef.current = null;
    };
  }, [wsConfig]);

  const onFileSaved = useCallback((workspace: WorkspaceResponse) => {
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

    const result = saveToLocalStorage(key, updated);
    if (!result.ok) {
      // Storage failed — surface to user via warning so they know edits are not durable.
      const msg =
        result.reason === 'quota_exceeded'
          ? 'Browser storage is full. Persist your changes now to avoid losing them.'
          : 'Browser storage is unavailable. Changes may not survive a page reload.';
      setStorageWarning(msg);
      // Still update in-memory state so the UI reflects the edit during this session.
      setStored(updated);
      return;
    }
    setStorageWarning(null);
    setStored(updated);

    // Notify other tabs
    try {
      channelRef.current?.postMessage({ type: TAB_MSG.UPDATED } satisfies TabMessage);
    } catch (err) {
      log.warn('failed to broadcast workspace-updated', err);
    }
  }, []);

  const restore = useCallback(async () => {
    if (!wsConfig) return;
    const key = getStorageKey(wsConfig.appId);
    const current = getStoredWorkspace(key);
    if (!current?.bundle || !current?.headSha) return;

    const res = await fetchWithTimeout(
      '/api/workspace/restore',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bundle: current.bundle, headSha: current.headSha }),
      },
      RUNTIME_FETCH_TIMEOUT_MS,
      'restore_failed',
      'restore',
    );

    if (res.status === 409) {
      // Deploy has changed since these edits were made — stored workspace is stale.
      // Throw a typed error so the caller can prompt the user to discard.
      // (isStale is also computed independently from localStorage as a backup signal.)
      throw new WorkspaceError(
        'restore_stale',
        'The agent has been redeployed since your edits began. Discard your changes and reload to start from the current deploy.',
      );
    }

    if (!res.ok) {
      throw new WorkspaceError(
        'restore_failed',
        `Restore failed: ${res.status} ${res.statusText}`,
      );
    }
  }, [wsConfig]);

  const persist = useCallback(async (): Promise<PersistResult> => {
    if (!wsConfig) {
      throw new WorkspaceError('no_config', 'Workspace not initialized');
    }
    const key = getStorageKey(wsConfig.appId);
    const current = getStoredWorkspace(key);
    if (!current?.bundle) {
      throw new WorkspaceError('no_changes', 'No changes to persist');
    }

    // Note: branch name format is duplicated on the server — see
    // platform-api/src/app/api/repos/[appId]/import-bundle/route.ts.
    // The server will use this if provided, or generate its own if absent.
    const branchName =
      current.persistedBranchName ?? `config/${wsConfig.appId}-${Date.now()}`;

    const res = await fetchWithTimeout(
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
      PERSIST_FETCH_TIMEOUT_MS,
      'persist_failed',
      'persist to platform-api',
    );

    if (!res.ok) {
      // Try to parse the error body for a structured message; fall back to status text.
      let detail = `${res.status} ${res.statusText}`;
      try {
        const errBody: unknown = await res.json();
        const message = readErrorMessage(errBody);
        if (message) detail = message;
      } catch (err) {
        log.warn('failed to parse persist error body', { err });
      }
      throw new WorkspaceError('persist_failed', `Persist failed: ${detail}`);
    }

    const body: unknown = await res.json();
    const data = parsePersistResult(body);
    if (!data) {
      throw new WorkspaceError(
        'persist_failed',
        'Persist response missing required fields (branch, headCommit, commitCount)',
      );
    }

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

    // Reset the server first. If it fails, throw — the caller decides whether
    // to clear local state. We don't silently clear localStorage because that
    // creates an inconsistent state (server has edits, client thinks clean).
    const res = await fetchWithTimeout(
      '/api/workspace/reset',
      { method: 'POST' },
      RUNTIME_FETCH_TIMEOUT_MS,
      'reset_failed',
      'workspace reset',
    );

    if (!res.ok) {
      throw new WorkspaceError(
        'reset_failed',
        `Server reset failed: ${res.status} ${res.statusText}`,
      );
    }

    // Server reset succeeded — safe to clear local state.
    const key = getStorageKey(wsConfig.appId);
    clearLocalStorage(key);
    setStored(null);
    setStorageWarning(null);
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
  const sizeWarning =
    bundleSize > BUNDLE_SIZE_WARNING_BYTES
      ? `Bundle is ${(bundleSize / 1024 / 1024).toFixed(1)}MB — consider persisting to avoid localStorage limits.`
      : null;

  // Storage warning takes precedence over size warning since it's more urgent.
  const warning = storageWarning ?? sizeWarning;

  // Always return the object so onFileSaved is available even before
  // the async config fetch completes. isDirty gates on wsConfig so
  // the WorkspaceBar won't render prematurely in local/OSS mode.
  return {
    ready,
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
