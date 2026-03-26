/**
 * @license
 * Copyright 2025 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

// Components
export { ChatWidget } from './components/ChatWidget';
export type { ChatWidgetProps } from './components/ChatWidget';

// Hooks
export { useChat } from './hooks/useChat';
export type { UseChatOptions, UseChatReturn } from './hooks/useChat';
export { useWidgetEvents } from './hooks/useWidgetEvents';
export type { UseWidgetEventsReturn } from './hooks/useWidgetEvents';
export { useSessionHistory } from './hooks/useSessionHistory';
export type { UseSessionHistoryOptions, UseSessionHistoryReturn } from './hooks/useSessionHistory';

// Client (existing)
export { createChatClient, streamChat, createSession, parseSSELine, listSessions, getSessionHistory, updateSession } from './client';
export type { ChatStreamRequest, SessionInfo, SessionHistoryItem, SessionDetail } from './client';

// Headless Client
export { ChatClient } from './client/ChatClient';
export type { ChatClientConfig, ClientEvents } from './client/ChatClient';
export { ChatStream } from './client/ChatStream';
export type { ChatResponse } from './client/ChatStream';
export { TypedEventEmitter } from './client/EventEmitter';

// Events
export { WidgetEventBus, defaultEntityExtractor } from './events';
export type {
  WidgetEvent,
  WidgetEventMap,
  EntityReference,
  EntityExtractor,
  AgentDrivenEvent,
  InteractionEvent,
  ToolExecutedEvent,
  SkillActivatedEvent,
  WidgetRenderedEvent,
  KBProposalEvent,
  EntityReferencedEvent,
  EntityHoveredEvent,
  EntityUnhoveredEvent,
  EntityClickedEvent,
} from './events';

// Theme
export { defaultTheme, applyTheme, mergeTheme } from './theme';

// Types
export type {
  ChatMessage,
  UserMessage,
  AssistantTextMessage,
  ErrorMessage,
  ToolCallInfo,
  KBProposalInfo,
  ContentBlock,
  WidgetInfo,
  ChatTheme,
  WidgetConfig,
  WidgetPosition,
  ChatUser,
  SSEEvent,
  ToolCallStatus,
} from './types';
