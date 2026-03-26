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

// Hooks
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

// Client
export { RuntimeClient } from './client/runtime-client';
export type { RuntimeClientOptions } from './client/runtime-client';
export { parseSSELine, streamSSE, streamSSEGet } from './client/sse-client';
export type { StreamSSEOptions } from './client/sse-client';

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
  SSEErrorEvent,
  SSEDoneEvent,
  ChatMessage,
  UserMessage,
  AssistantTextMessage,
  ErrorMessage,
  ToolCallInfo,
  ToolCallStatus,
  ConfirmationInfo,
  ContentBlock,
  SubagentEventInfo,
  ChatState,
  ChatAction,
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
