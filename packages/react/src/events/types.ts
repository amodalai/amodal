/**
 * @license
 * Copyright 2025 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import type { ToolCallInfo, KBProposalInfo } from '../types';

// ---------------------------------------------------------------------------
// Entity reference — shared payload for entity-related events
// ---------------------------------------------------------------------------

export interface EntityReference {
  entityType: string;
  entityId: string;
  source: string;
  context?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Agent-driven events (from SSE stream, no server changes)
// ---------------------------------------------------------------------------

export interface ToolExecutedEvent {
  type: 'tool_executed';
  toolName: string;
  toolId: string;
  parameters: Record<string, unknown>;
  status: 'success' | 'error';
  result?: unknown;
  duration_ms?: number;
  error?: string;
  timestamp: string;
}

export interface SkillActivatedEvent {
  type: 'skill_activated';
  skill: string;
  timestamp: string;
}

export interface WidgetRenderedEvent {
  type: 'widget_rendered';
  widgetType: string;
  data: Record<string, unknown>;
  timestamp: string;
}

export interface KBProposalEvent {
  type: 'kb_proposal';
  proposal: KBProposalInfo;
  timestamp: string;
}

export interface EntityReferencedEvent {
  type: 'entity_referenced';
  entity: EntityReference;
  sourceEvent: WidgetEvent;
  timestamp: string;
}

// ---------------------------------------------------------------------------
// User interaction events (from React component handlers)
// ---------------------------------------------------------------------------

export interface EntityHoveredEvent {
  type: 'entity_hovered';
  entity: EntityReference;
  timestamp: string;
}

export interface EntityUnhoveredEvent {
  type: 'entity_unhovered';
  entity: EntityReference;
  timestamp: string;
}

export interface EntityClickedEvent {
  type: 'entity_clicked';
  entity: EntityReference;
  timestamp: string;
}

// ---------------------------------------------------------------------------
// Discriminated union of all event types
// ---------------------------------------------------------------------------

export type AgentDrivenEvent =
  | ToolExecutedEvent
  | SkillActivatedEvent
  | WidgetRenderedEvent
  | KBProposalEvent
  | EntityReferencedEvent;

export type InteractionEvent =
  | EntityHoveredEvent
  | EntityUnhoveredEvent
  | EntityClickedEvent;

export type WidgetEvent = AgentDrivenEvent | InteractionEvent;

// ---------------------------------------------------------------------------
// Event map for typed event bus
// ---------------------------------------------------------------------------

export interface WidgetEventMap {
  tool_executed: ToolExecutedEvent;
  skill_activated: SkillActivatedEvent;
  widget_rendered: WidgetRenderedEvent;
  kb_proposal: KBProposalEvent;
  entity_referenced: EntityReferencedEvent;
  entity_hovered: EntityHoveredEvent;
  entity_unhovered: EntityUnhoveredEvent;
  entity_clicked: EntityClickedEvent;
  '*': WidgetEvent;
}

// ---------------------------------------------------------------------------
// Entity extractor function type
// ---------------------------------------------------------------------------

export type EntityExtractor = (event: WidgetEvent) => EntityReference[];

// Re-export ToolCallInfo for convenience
export type { ToolCallInfo, KBProposalInfo };
