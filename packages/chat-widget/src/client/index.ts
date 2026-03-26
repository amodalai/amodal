/**
 * @license
 * Copyright 2025 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

export { ChatClient } from './ChatClient';
export type { ChatClientConfig, ClientEvents } from './ChatClient';
export { ChatStream } from './ChatStream';
export type { ChatResponse } from './ChatStream';
export { TypedEventEmitter } from './EventEmitter';

// Re-export event types for headless consumers
export { WidgetEventBus, defaultEntityExtractor } from '../events';
export type {
  WidgetEvent,
  WidgetEventMap,
  EntityReference,
  EntityExtractor,
  ToolExecutedEvent,
  SkillActivatedEvent,
  WidgetRenderedEvent,
  KBProposalEvent,
  EntityReferencedEvent,
  EntityHoveredEvent,
  EntityUnhoveredEvent,
  EntityClickedEvent,
} from '../events';
