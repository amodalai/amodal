/**
 * @license
 * Copyright 2025 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import type { SSEEvent, TaskStatus, StoreDefinitionInfo, StoreListResult, StoreDocumentResult } from '../types';
import { streamSSE, streamSSEGet } from './sse-client';

export interface RuntimeClientOptions {
  runtimeUrl: string;
  tenantId: string;
  getToken?: () => string | Promise<string> | null | undefined;
}

/**
 * Client for the Amodal runtime's repo routes.
 * Targets POST /chat, POST /task, GET /task/:id, GET /task/:id/stream.
 */
export class RuntimeClient {
  private readonly runtimeUrl: string;
  private readonly tenantId: string;
  private readonly getToken?: () => string | Promise<string> | null | undefined;

  constructor(options: RuntimeClientOptions) {
    this.runtimeUrl = options.runtimeUrl.replace(/\/$/, '');
    this.tenantId = options.tenantId;
    this.getToken = options.getToken;
  }

  private async authHeaders(): Promise<Record<string, string>> {
    const headers: Record<string, string> = {};
    if (this.getToken) {
      const token = await this.getToken();
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      }
    }
    return headers;
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
      tenant_id: this.tenantId,
    };
    if (options?.sessionId) {
      body['session_id'] = options.sessionId;
    }
    if (options?.context) {
      body['context'] = options.context;
    }

    const headers = await this.authHeaders();

    yield* streamSSE(url, body, {
      signal: options?.signal,
      headers,
    });
  }

  /**
   * Start a fire-and-forget task via POST /task.
   */
  async startTask(
    prompt: string,
    tenantToken?: string,
  ): Promise<{ task_id: string }> {
    const url = `${this.runtimeUrl}/task`;
    const headers = await this.authHeaders();

    const body: Record<string, unknown> = {
      prompt,
      tenant_id: this.tenantId,
    };
    if (tenantToken) {
      body['tenant_token'] = tenantToken;
    }

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
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
    const headers = await this.authHeaders();

    const response = await fetch(url, {
      method: 'GET',
      headers,
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
    const headers = await this.authHeaders();

    yield* streamSSEGet(url, { signal, headers });
  }

  // ---------------------------------------------------------------------------
  // Store API
  // ---------------------------------------------------------------------------

  /**
   * List all store definitions with document counts.
   */
  async getStores(signal?: AbortSignal): Promise<StoreDefinitionInfo[]> {
    const url = `${this.runtimeUrl}/api/stores`;
    const headers = await this.authHeaders();

    const response = await fetch(url, { headers, signal });
    if (!response.ok) {
      throw new Error(`Failed to fetch stores: ${String(response.status)}`);
    }

    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- Server response
    const body = (await response.json()) as { stores: StoreDefinitionInfo[] };
    return body.stores;
  }

  /**
   * List documents from a store with optional filtering.
   */
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
    const headers = await this.authHeaders();

    const response = await fetch(url, { headers, signal: options?.signal });
    if (!response.ok) {
      throw new Error(`Failed to fetch store documents: ${String(response.status)}`);
    }

    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- Server response
    return (await response.json()) as StoreListResult;
  }

  /**
   * Get a single document by key, optionally with version history.
   */
  async getStoreDocument(
    storeName: string,
    key: string,
    signal?: AbortSignal,
  ): Promise<StoreDocumentResult> {
    const url = `${this.runtimeUrl}/api/stores/${storeName}/${encodeURIComponent(key)}`;
    const headers = await this.authHeaders();

    const response = await fetch(url, { headers, signal });
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
