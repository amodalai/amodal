/**
 * @license
 * Copyright 2025 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

// Main widget component
export { ChatWidget } from './ChatWidget';
export type { ChatWidgetProps } from './ChatWidget';

// Widget sub-components
export { MessageList } from './MessageList';
export { InputBar } from './InputBar';
export { SessionHistory } from './SessionHistory';
export type { SessionHistoryProps } from './SessionHistory';
export { StreamingIndicator } from './StreamingIndicator';
export { AskUserCard } from './AskUserCard';
export { KBProposalCard } from './KBProposalCard';
export { ToolCallCard } from './ToolCallCard';
export { SkillPill } from './SkillPill';
export { TagEditor } from './TagEditor';
export { FormattedText } from './FormattedText';

// Rich widget renderers
export { WidgetRenderer } from './widgets/WidgetRenderer';
export type { WidgetRegistry } from './widgets/WidgetRenderer';

// Hooks (convenience re-exports)
export { useChat } from '../hooks/useChat';
export type { UseChatOptions, UseChatReturn } from '../hooks/useChat';
export { useWidgetEvents } from '../hooks/useWidgetEvents';
export type { UseWidgetEventsReturn } from '../hooks/useWidgetEvents';
export { useSessionHistory } from '../hooks/useSessionHistory';
export type { UseSessionHistoryOptions, UseSessionHistoryReturn } from '../hooks/useSessionHistory';

// Client API (convenience re-exports for consumers that used @amodalai/chat-widget)
export { listSessions, getSessionHistory, createSession } from '../client/chat-api';
export type { SessionHistoryItem } from '../client/chat-api';

// Core types (convenience re-exports)
export type { ChatMessage, AssistantTextMessage, ToolCallInfo, ContentBlock } from '../types';

// Theme utilities
export { defaultTheme, applyTheme, mergeTheme } from '../theme';

// Events (convenience re-exports)
export { WidgetEventBus, defaultEntityExtractor } from '../events';
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
} from '../events';

// Widget CSS — consumers import via '@amodalai/react/widget/style.css'
