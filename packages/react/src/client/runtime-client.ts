/**
 * @license
 * Copyright 2025 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import type { SSEEvent, TaskStatus, StoreDefinitionInfo, StoreListResult, StoreDocumentResult } from '../types';
import { streamSSE, streamSSEGet } from './sse-client';

export interface RuntimeClientOptions {
  runtimeUrl: string;
}

/**
 * Client for the Amodal runtime's repo routes.
 * Auth is handled server-side via cookies — no tokens needed from the client.
 */
export class RuntimeClient {
  private readonly runtimeUrl: string;

  constructor(options: RuntimeClientOptions) {
    this.runtimeUrl = options.runtimeUrl.replace(/\/$/, '');
  }

  /**
   * Stream a chat message via POST /chat.
   */
  async *chatStream(
    message: string,
    options?: {
      sessionId?: string;
      context?: Record<string, unknown>;
      signal?: AbortSignal;
    },
  ): AsyncGenerator<SSEEvent> {
    const url = `${this.runtimeUrl}/chat`;
    const body: Record<string, unknown> = {
      message,
    };
    if (options?.sessionId) {
      body['session_id'] = options.sessionId;
    }
    if (options?.context) {
      body['context'] = options.context;
    }

    yield* streamSSE(url, body, {
      signal: options?.signal,
    });
  }

  /**
   * Start a fire-and-forget task via POST /task.
   */
  async startTask(prompt: string): Promise<{ task_id: string }> {
    const url = `${this.runtimeUrl}/task`;
    const body: Record<string, unknown> = { prompt };

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      throw new Error(`Start task failed: ${String(response.status)} ${response.statusText}`);
    }

    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- Server response
    return (await response.json()) as { task_id: string };
  }

  /**
   * Get task status via GET /task/:id.
   */
  async getTaskStatus(taskId: string): Promise<TaskStatus> {
    const url = `${this.runtimeUrl}/task/${taskId}`;

    const response = await fetch(url, {
      method: 'GET',
      credentials: 'include',
    });

    if (!response.ok) {
      throw new Error(`Get task status failed: ${String(response.status)} ${response.statusText}`);
    }

    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- Server response
    return (await response.json()) as TaskStatus;
  }

  /**
   * Stream task events via GET /task/:id/stream.
   */
  async *streamTask(
    taskId: string,
    signal?: AbortSignal,
  ): AsyncGenerator<SSEEvent> {
    const url = `${this.runtimeUrl}/task/${taskId}/stream`;
    yield* streamSSEGet(url, { signal });
  }

  // ---------------------------------------------------------------------------
  // Store API
  // ---------------------------------------------------------------------------

  async getStores(signal?: AbortSignal): Promise<StoreDefinitionInfo[]> {
    const url = `${this.runtimeUrl}/api/stores`;
    const response = await fetch(url, { credentials: 'include', signal });
    if (!response.ok) {
      throw new Error(`Failed to fetch stores: ${String(response.status)}`);
    }
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- Server response
    const body = (await response.json()) as { stores: StoreDefinitionInfo[] };
    return body.stores;
  }

  async getStoreDocuments(
    storeName: string,
    options?: {
      filter?: Record<string, unknown>;
      sort?: string;
      limit?: number;
      offset?: number;
      signal?: AbortSignal;
    },
  ): Promise<StoreListResult> {
    const params = new URLSearchParams();
    if (options?.filter) {
      params.set('filter', JSON.stringify(options.filter));
    }
    if (options?.sort) {
      params.set('sort', options.sort);
    }
    if (options?.limit !== undefined) {
      params.set('limit', String(options.limit));
    }
    if (options?.offset !== undefined) {
      params.set('offset', String(options.offset));
    }

    const qs = params.toString();
    const url = `${this.runtimeUrl}/api/stores/${storeName}${qs ? `?${qs}` : ''}`;
    const response = await fetch(url, { credentials: 'include', signal: options?.signal });
    if (!response.ok) {
      throw new Error(`Failed to fetch store documents: ${String(response.status)}`);
    }
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- Server response
    return (await response.json()) as StoreListResult;
  }

  async getStoreDocument(
    storeName: string,
    key: string,
    signal?: AbortSignal,
  ): Promise<StoreDocumentResult> {
    const url = `${this.runtimeUrl}/api/stores/${storeName}/${encodeURIComponent(key)}`;
    const response = await fetch(url, { credentials: 'include', signal });
    if (!response.ok) {
      if (response.status === 404) {
        return { document: null, history: [] };
      }
      throw new Error(`Failed to fetch store document: ${String(response.status)}`);
    }
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- Server response
    return (await response.json()) as StoreDocumentResult;
  }
}
