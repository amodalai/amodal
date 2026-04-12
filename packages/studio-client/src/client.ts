/**
 * @license
 * Copyright 2025 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import { StudioFetchError, StudioResponseParseError } from './errors.js';
import type {
  DraftFile,
  PublishResult,
  PreviewResult,
  WorkspaceBundle,
  WorkspaceChange,
} from './types.js';

// ---------------------------------------------------------------------------
// Route constants
// ---------------------------------------------------------------------------

const ROUTES = {
  DRAFTS: '/api/studio/drafts',
  DISCARD: '/api/studio/discard',
  PUBLISH: '/api/studio/publish',
  PREVIEW: '/api/studio/preview',
  WORKSPACE: '/api/studio/workspace',
  BATCH: '/api/studio/drafts/batch',
} as const;

// ---------------------------------------------------------------------------
// Public interfaces
// ---------------------------------------------------------------------------

export interface StudioClientOptions {
  /** Base URL of the Studio server, e.g. `http://localhost:3848`. */
  baseUrl: string;
  /** JWT bearer token for authenticated requests. Omitted for local dev. */
  authToken?: string;
  /** Injectable fetch implementation (defaults to global `fetch`). */
  fetchImpl?: typeof fetch;
  /** Timeout in milliseconds for each HTTP request (default: 30 000). */
  timeoutMs?: number;
}

export interface StudioClient {
  listDrafts(): Promise<DraftFile[]>;
  getDraft(filePath: string): Promise<string | null>;
  saveDraft(filePath: string, content: string): Promise<void>;
  deleteDraft(filePath: string): Promise<void>;
  discardAll(): Promise<void>;
  publish(commitMessage: string): Promise<PublishResult>;
  buildPreview(): Promise<PreviewResult>;
  fetchWorkspaceBundle(agentId?: string): Promise<WorkspaceBundle>;
  submitDiff(changes: WorkspaceChange[]): Promise<void>;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

interface BatchChange {
  path: string;
  action: 'upsert' | 'delete';
  content?: string;
}

function mapWorkspaceChangeToBatch(change: WorkspaceChange): BatchChange {
  switch (change.action) {
    case 'added':
    case 'modified':
      return { path: change.path, action: 'upsert', content: change.content };
    case 'deleted':
      return { path: change.path, action: 'delete' };
    default: {
      const _exhaustive: never = change.action;
      return _exhaustive;
    }
  }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

const DEFAULT_TIMEOUT_MS = 30_000;

export function createStudioClient(options: StudioClientOptions): StudioClient {
  const { baseUrl, authToken, fetchImpl = globalThis.fetch, timeoutMs = DEFAULT_TIMEOUT_MS } = options;

  function headers(json: boolean): Record<string, string> {
    const h: Record<string, string> = {};
    if (json) {
      h['Content-Type'] = 'application/json';
    }
    if (authToken) {
      h['Authorization'] = `Bearer ${authToken}`;
    }
    return h;
  }

  function url(path: string): string {
    return `${baseUrl}${path}`;
  }

  function draftUrl(filePath: string): string {
    return url(`${ROUTES.DRAFTS}/${encodeURIComponent(filePath)}`);
  }

  async function assertOk(res: Response, reqUrl: string): Promise<void> {
    if (!res.ok) {
      const body = await res.text();
      throw new StudioFetchError(reqUrl, res.status, res.statusText, body);
    }
  }

  async function parseJson(res: Response, reqUrl: string): Promise<unknown> {
    try {
      return await res.json();
    } catch (cause: unknown) {
      throw new StudioResponseParseError(reqUrl, cause);
    }
  }

  return {
    async listDrafts(): Promise<DraftFile[]> {
      const reqUrl = url(ROUTES.DRAFTS);
      const res = await fetchImpl(reqUrl, { method: 'GET', headers: headers(false), signal: AbortSignal.timeout(timeoutMs) });
      await assertOk(res, reqUrl);
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- Server response at system boundary
      const body = (await parseJson(res, reqUrl)) as { drafts: DraftFile[] };
      return body.drafts;
    },

    async getDraft(filePath: string): Promise<string | null> {
      const reqUrl = draftUrl(filePath);
      const res = await fetchImpl(reqUrl, { method: 'GET', headers: headers(false), signal: AbortSignal.timeout(timeoutMs) });
      if (res.status === 404) {
        return null;
      }
      await assertOk(res, reqUrl);
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- Server response at system boundary
      const data = (await parseJson(res, reqUrl)) as { draft: DraftFile };
      return data.draft.content;
    },

    async saveDraft(filePath: string, content: string): Promise<void> {
      const reqUrl = draftUrl(filePath);
      const res = await fetchImpl(reqUrl, {
        method: 'PUT',
        headers: headers(true),
        body: JSON.stringify({ content }),
        signal: AbortSignal.timeout(timeoutMs),
      });
      await assertOk(res, reqUrl);
    },

    async deleteDraft(filePath: string): Promise<void> {
      const reqUrl = draftUrl(filePath);
      const res = await fetchImpl(reqUrl, {
        method: 'DELETE',
        headers: headers(false),
        signal: AbortSignal.timeout(timeoutMs),
      });
      await assertOk(res, reqUrl);
    },

    async discardAll(): Promise<void> {
      const reqUrl = url(ROUTES.DISCARD);
      const res = await fetchImpl(reqUrl, {
        method: 'POST',
        headers: headers(false),
        signal: AbortSignal.timeout(timeoutMs),
      });
      await assertOk(res, reqUrl);
    },

    async publish(commitMessage: string): Promise<PublishResult> {
      const reqUrl = url(ROUTES.PUBLISH);
      const res = await fetchImpl(reqUrl, {
        method: 'POST',
        headers: headers(true),
        body: JSON.stringify({ commitMessage }),
        signal: AbortSignal.timeout(timeoutMs),
      });
      await assertOk(res, reqUrl);
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- Server response at system boundary
      return (await parseJson(res, reqUrl)) as PublishResult;
    },

    async buildPreview(): Promise<PreviewResult> {
      const reqUrl = url(ROUTES.PREVIEW);
      const res = await fetchImpl(reqUrl, {
        method: 'POST',
        headers: headers(false),
        signal: AbortSignal.timeout(timeoutMs),
      });
      await assertOk(res, reqUrl);
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- Server response at system boundary
      return (await parseJson(res, reqUrl)) as PreviewResult;
    },

    async fetchWorkspaceBundle(agentId?: string): Promise<WorkspaceBundle> {
      const params = agentId ? `?agentId=${encodeURIComponent(agentId)}` : '';
      const reqUrl = url(`${ROUTES.WORKSPACE}${params}`);
      const res = await fetchImpl(reqUrl, { method: 'GET', headers: headers(false), signal: AbortSignal.timeout(timeoutMs) });
      await assertOk(res, reqUrl);
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- Server response at system boundary
      return (await parseJson(res, reqUrl)) as WorkspaceBundle;
    },

    async submitDiff(changes: WorkspaceChange[]): Promise<void> {
      const batchChanges = changes.map(mapWorkspaceChangeToBatch);
      const reqUrl = url(ROUTES.BATCH);
      const res = await fetchImpl(reqUrl, {
        method: 'POST',
        headers: headers(true),
        body: JSON.stringify({ changes: batchChanges }),
        signal: AbortSignal.timeout(timeoutMs),
      });
      await assertOk(res, reqUrl);
    },
  };
}
