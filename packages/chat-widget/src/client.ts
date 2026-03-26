/**
 * @license
 * Copyright 2025 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import type { SSEEvent } from './types';

export interface ChatStreamRequest {
  message: string;
  session_id?: string;
  role?: string;
  session_type?: string;
  deploy_id?: string;
}

export interface SessionInfo {
  session_id: string;
  role: string;
}

/**
 * Parse a single SSE data line into a typed event.
 * Returns null for non-data lines or empty data.
 */
export function parseSSELine(line: string): SSEEvent | null {
  if (!line.startsWith('data: ')) return null;
  const json = line.slice(6).trim();
  if (json.length === 0) return null;
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- SSE event from server
  return JSON.parse(json) as SSEEvent;
}

/**
 * Streams chat responses from the API server's SSE endpoint.
 * Uses fetch + ReadableStream (not EventSource, which only supports GET).
 */
export async function* streamChat(
  serverUrl: string,
  request: ChatStreamRequest,
  signal?: AbortSignal,
  token?: string,
): AsyncGenerator<SSEEvent> {
  const url = `${serverUrl}/chat/stream`;

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const response = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(request),
    signal,
  });

  if (!response.ok) {
    throw new Error(`Chat request failed: ${String(response.status)} ${response.statusText}`);
  }

  const body = response.body;
  if (!body) {
    throw new Error('Response body is null');
  }

  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      const lines = buffer.split('\n');
      // Keep the last partial line in the buffer
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.length === 0) continue;
        const event = parseSSELine(trimmed);
        if (event) {
          yield event;
        }
      }
    }

    // Process any remaining buffer
    if (buffer.trim().length > 0) {
      const event = parseSSELine(buffer.trim());
      if (event) {
        yield event;
      }
    }
  } finally {
    reader.releaseLock();
  }
}

/**
 * Creates a new chat session on the server.
 */
export async function createSession(
  serverUrl: string,
  user: { id: string; role?: string },
  token?: string,
): Promise<SessionInfo> {
  const url = `${serverUrl}/sessions`;

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const body: Record<string, string> = { user_id: user.id };
  if (user.role) body['role'] = user.role;

  const response = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    throw new Error(`Session creation failed: ${String(response.status)} ${response.statusText}`);
  }

  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- Server response
  return (await response.json()) as SessionInfo;
}

// ---------------------------------------------------------------------------
// Session history API
// ---------------------------------------------------------------------------

export interface SessionHistoryItem {
  id: string;
  tenant_id: string;
  app_id?: string;
  title?: string;
  tags: string[];
  status: string;
  session_type?: string;
  message_count: number;
  created_at: string;
  updated_at: string;
}

export interface SessionDetail extends SessionHistoryItem {
  messages: Array<{
    type: string;
    id: string;
    text: string;
    timestamp: string;
    toolCalls?: Array<Record<string, unknown>>;
    skillActivations?: string[];
    widgets?: Array<Record<string, unknown>>;
    contentBlocks?: Array<Record<string, unknown>>;
  }>;
}

function authHeaders(token?: string | null): Record<string, string> {
  const headers: Record<string, string> = {};
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  return headers;
}

/**
 * List past sessions for the authenticated tenant.
 */
export async function listSessions(
  serverUrl: string,
  token?: string | null,
  tags?: string[],
): Promise<SessionHistoryItem[]> {
  const qs = tags && tags.length > 0 ? `?tags=${tags.join(',')}` : '';
  const url = `${serverUrl}/sessions/history${qs}`;

  const response = await fetch(url, { headers: authHeaders(token) });
  if (!response.ok) {
    throw new Error(`List sessions failed: ${String(response.status)} ${response.statusText}`);
  }
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- Server response
  return (await response.json()) as SessionHistoryItem[];
}

/**
 * Get a single session with full message history.
 */
export async function getSessionHistory(
  serverUrl: string,
  sessionId: string,
  token?: string | null,
): Promise<SessionDetail> {
  const url = `${serverUrl}/sessions/history/${sessionId}`;

  const response = await fetch(url, { headers: authHeaders(token) });
  if (!response.ok) {
    throw new Error(`Get session failed: ${String(response.status)} ${response.statusText}`);
  }
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- Server response
  return (await response.json()) as SessionDetail;
}

/**
 * Update session title and/or tags.
 */
export async function updateSession(
  serverUrl: string,
  sessionId: string,
  updates: { title?: string; tags?: string[] },
  token?: string | null,
): Promise<SessionDetail> {
  const url = `${serverUrl}/sessions/history/${sessionId}`;

  const response = await fetch(url, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      ...authHeaders(token),
    },
    body: JSON.stringify(updates),
  });
  if (!response.ok) {
    throw new Error(`Update session failed: ${String(response.status)} ${response.statusText}`);
  }
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- Server response
  return (await response.json()) as SessionDetail;
}

/**
 * Creates a configured chat client instance.
 */
export function createChatClient(serverUrl: string, token?: string) {
  return {
    stream: (request: ChatStreamRequest, signal?: AbortSignal) =>
      streamChat(serverUrl, request, signal, token),
    createSession: (user: { id: string; role?: string }) =>
      createSession(serverUrl, user, token),
    listSessions: (tags?: string[]) => listSessions(serverUrl, token, tags),
    getSessionHistory: (sessionId: string) => getSessionHistory(serverUrl, sessionId, token),
    updateSession: (sessionId: string, updates: { title?: string; tags?: string[] }) =>
      updateSession(serverUrl, sessionId, updates, token),
  };
}
