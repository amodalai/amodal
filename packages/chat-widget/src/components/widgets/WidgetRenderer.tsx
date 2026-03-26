/**
 * @license
 * Copyright 2025 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import { Component, type ComponentType, type ReactNode } from 'react';
import type { InteractionEvent } from '../../events/types';
import { EntityCard } from './EntityCard';
import { EntityList } from './EntityList';
import { ScopeMap } from './ScopeMap';
import { AlertCard } from './AlertCard';
import { Timeline } from './Timeline';
import { Comparison } from './Comparison';
import { DataTable } from './DataTable';
import { ScoreBreakdown } from './ScoreBreakdown';
import { StatusBoard } from './StatusBoard';
import { CredentialInput } from './CredentialInput';
import { DocumentPreview } from './DocumentPreview';
import { InfoCard } from './InfoCard';
import { Metric } from './Metric';

/**
 * Props that every widget component receives.
 */
export interface WidgetProps<T = Record<string, unknown>> {
  data: T;
  sendMessage: (text: string) => void;
  onInteraction?: (event: InteractionEvent) => void;
}

/**
 * Map of widget type string → component.
 */
export type WidgetRegistry = Record<string, ComponentType<WidgetProps>>;

const platformWidgets: WidgetRegistry = {
  'entity-card': EntityCard,
  'entity-list': EntityList,
  'scope-map': ScopeMap,
  'alert-card': AlertCard,
  'timeline': Timeline,
  'comparison': Comparison,
  'data-table': DataTable,
  'score-breakdown': ScoreBreakdown,
  'status-board': StatusBoard,
  'credential-input': CredentialInput,
  'document-preview': DocumentPreview,
  'info-card': InfoCard,
  'metric': Metric,
};

/**
 * Error boundary that catches widget render errors and falls back to JSON.
 */
class WidgetErrorBoundary extends Component<
  { widgetType: string; data: Record<string, unknown>; children: ReactNode },
  { error: Error | null }
> {
  constructor(props: { widgetType: string; data: Record<string, unknown>; children: ReactNode }) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  render() {
    if (this.state.error) {
      return (
        <div className="pcw-widget-card pcw-widget-card--generic">
          <div className="pcw-widget-card__header">
            <span className="pcw-widget-card__type">{this.props.widgetType}</span>
            <span style={{ color: 'var(--pcw-error, #ef4444)', fontSize: '12px', marginLeft: '8px' }}>
              render error
            </span>
          </div>
          <pre className="pcw-widget-card__json">
            {JSON.stringify(this.props.data, null, 2)}
          </pre>
        </div>
      );
    }
    return this.props.children;
  }
}

interface WidgetRendererProps {
  widgetType: string;
  data: Record<string, unknown>;
  sendMessage: (text: string) => void;
  customWidgets?: WidgetRegistry;
  onInteraction?: (event: InteractionEvent) => void;
}

/**
 * Renders a widget by looking up the type in custom widgets first,
 * then platform widgets, then falling back to a generic JSON display.
 */
export function WidgetRenderer({
  widgetType,
  data,
  sendMessage,
  customWidgets,
  onInteraction,
}: WidgetRendererProps) {
  // Check custom widgets first, then platform widgets
  const WidgetComponent = customWidgets?.[widgetType] ?? platformWidgets[widgetType];

  if (WidgetComponent) {
    return (
      <WidgetErrorBoundary widgetType={widgetType} data={data}>
        <WidgetComponent data={data} sendMessage={sendMessage} onInteraction={onInteraction} />
      </WidgetErrorBoundary>
    );
  }

  // Fallback: render as formatted JSON
  return (
    <div className="pcw-widget-card pcw-widget-card--generic">
      <div className="pcw-widget-card__header">
        <span className="pcw-widget-card__type">{widgetType}</span>
      </div>
      <pre className="pcw-widget-card__json">
        {JSON.stringify(data, null, 2)}
      </pre>
    </div>
  );
}
