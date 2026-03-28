/**
 * @license
 * Copyright 2025 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

// SSE streaming utilities
export { parseSSELine, streamSSE, streamSSEGet } from './sse-client';
export type { StreamSSEOptions } from './sse-client';

// Runtime client (for /chat, /task, /api/stores)
export { RuntimeClient } from './runtime-client';
export type { RuntimeClientOptions } from './runtime-client';

// Chat API (for /chat/stream, /sessions)
export { streamChat, createSession, createChatClient, listSessions, getSessionHistory, updateSession } from './chat-api';
export type { ChatStreamRequest, SessionInfo, SessionHistoryItem, SessionDetail } from './chat-api';

// Headless client
export { ChatClient } from './ChatClient';
export type { ChatClientConfig, ClientEvents } from './ChatClient';
export { ChatStream } from './ChatStream';
export type { ChatResponse } from './ChatStream';
export { TypedEventEmitter } from './EventEmitter';
