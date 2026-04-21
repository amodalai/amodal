/**
 * @license
 * Copyright 2025 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

// Provider
export { AmodalProvider, useAmodalContext } from './provider';
export type { AmodalProviderProps } from './provider';

// Chat
export { AmodalChat } from './chat';
export type { AmodalChatProps } from './chat';

// Action
export { AmodalAction } from './components/AmodalAction';
export type { AmodalActionProps } from './components/AmodalAction';

// Confirmation components
export { ConfirmCard } from './components/ConfirmCard';
export type { ConfirmCardProps } from './components/ConfirmCard';
export { ReviewCard } from './components/ReviewCard';
export type { ReviewCardProps } from './components/ReviewCard';

// Markdown renderer
export { FormattedMarkdown } from './components/FormattedMarkdown';

// Hooks — provider-based (runtime API)
export { useAmodalChat } from './hooks/useAmodalChat';
export type { UseAmodalChatOptions, UseAmodalChatReturn } from './hooks/useAmodalChat';
export { useAmodalBrief } from './hooks/useAmodalBrief';
export type { UseAmodalBriefOptions, UseAmodalBriefReturn } from './hooks/useAmodalBrief';
export { useAmodalInsight } from './hooks/useAmodalInsight';
export type { UseAmodalInsightOptions, UseAmodalInsightReturn } from './hooks/useAmodalInsight';
export { useAmodalTask } from './hooks/useAmodalTask';
export type { UseAmodalTaskOptions, UseAmodalTaskReturn } from './hooks/useAmodalTask';
export { useAmodalQuery } from './hooks/useAmodalQuery';
export type { UseAmodalQueryOptions, UseAmodalQueryReturn } from './hooks/useAmodalQuery';

// Store hooks
export { useStore } from './hooks/useStore';
export type { UseStoreOptions, UseStoreReturn } from './hooks/useStore';
export { useStoreList } from './hooks/useStoreList';
export type { UseStoreListOptions, UseStoreListReturn } from './hooks/useStoreList';
export { useSkillAction } from './hooks/useSkillAction';
export type { UseSkillActionOptions, UseSkillActionReturn } from './hooks/useSkillAction';
export { useNavigate, NavigateContext } from './hooks/useNavigate';
export type { NavigateFn } from './hooks/useNavigate';

// Image paste hook
export { useImagePaste, DEFAULT_IMAGE_PROMPT } from './hooks/useImagePaste';
export type { ImageAttachment, UseImagePasteOptions } from './hooks/useImagePaste';

// Hooks — widget-oriented (chat API)
export { useChat } from './hooks/useChat';
export type { UseChatOptions, UseChatReturn } from './hooks/useChat';
export { useChatStream, chatReducer } from './hooks/useChatStream';
export type { UseChatStreamOptions, UseChatStreamReturn } from './hooks/useChatStream';
export { useWidgetEvents } from './hooks/useWidgetEvents';
export type { UseWidgetEventsReturn } from './hooks/useWidgetEvents';
export { useSessionHistory } from './hooks/useSessionHistory';
export type { UseSessionHistoryOptions, UseSessionHistoryReturn } from './hooks/useSessionHistory';

// Client — SSE utilities
export { RuntimeClient } from './client/runtime-client';
export type { RuntimeClientOptions } from './client/runtime-client';
export { parseSSELine, streamSSE, streamSSEGet } from './client/sse-client';
export type { StreamSSEOptions } from './client/sse-client';

// Client — chat API
export { ChatApiError, streamChat, createSession, createChatClient, listSessions, getSessionHistory, updateSession } from './client/chat-api';
export type { ChatStreamRequest, SessionInfo, SessionHistoryItem, SessionDetail } from './client/chat-api';

// Headless client
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
  SSEEvent,
  SSEEventType,
  SSEInitEvent,
  SSETextDeltaEvent,
  SSEToolCallStartEvent,
  SSEToolCallResultEvent,
  SSESubagentEvent,
  SSESkillActivatedEvent,
  SSEWidgetEvent,
  SSEKBProposalEvent,
  SSEConfirmationRequiredEvent,
  SSECredentialSavedEvent,
  SSEApprovedEvent,
  SSEAskUserEvent,
  SSEExploreStartEvent,
  SSEExploreEndEvent,
  SSEPlanModeEvent,
  SSEFieldScrubEvent,
  SSEErrorEvent,
  SSEDoneEvent,
  AskUserQuestion,
  AskUserQuestionOption,
  AskUserStatus,
  AskUserBlock,
  ChatMessage,
  UserMessage,
  AssistantTextMessage,
  ErrorMessage,
  ToolCallInfo,
  ToolCallStatus,
  ConfirmationInfo,
  KBProposalInfo,
  WidgetInfo,
  ContentBlock,
  SubagentEventInfo,
  ChatState,
  ChatAction,
  ChatUser,
  ChatTheme,
  WidgetConfig,
  WidgetPosition,
  TaskStatus,
  TaskStatusValue,
  BriefResult,
  InsightResult,
  QueryResult,
  StoreFieldDefinitionInfo,
  StoreEntityInfo,
  StoreDefinitionInfo,
  StoreDocumentMeta,
  StoreDocument,
  StoreListResult,
  StoreDocumentResult,
} from './types';
