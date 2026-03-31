/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

/**
 * Tool name constant for the present tool.
 */
export const PRESENT_TOOL_NAME = 'present';

/**
 * Available widget types that the present tool can render.
 */
export const WIDGET_TYPES = [
  'entity-card',
  'entity-list',
  'scope-map',
  'alert-card',
  'timeline',
  'comparison',
  'data-table',
  'score-breakdown',
  'status-board',
  'credential-input',
  'document-preview',
  'info-card',
  'metric',
] as const;

/**
 * Widget type string literal union.
 */
export type WidgetType = (typeof WIDGET_TYPES)[number];

/**
 * Parameters for the present tool invocation.
 */
export interface PresentParams {
  widget: string;
  data: Record<string, unknown>;
}

/**
 * Data shape for the credential-input widget.
 */
export interface CredentialInputData {
  connection_name: string;
  app_id: string;
  fields: Array<{
    name: string;
    label: string;
    type: 'text' | 'password';
    required?: boolean;
  }>;
}

/**
 * Data shape for the document-preview widget.
 */
export interface DocumentPreviewData {
  preview_id: string;
  resource_type: 'kb_document' | 'tool' | 'skill' | 'subagent' | 'automation';
  title: string;
  body: string;
  category?: string;
  action: 'create' | 'update';
  proposal_id?: string;
}

/**
 * Data shape for the info-card widget.
 */
export interface InfoCardData {
  title: string;
  subtitle?: string;
  description?: string;
  fields: Array<{ label: string; value: string | number | boolean }>;
  tags?: string[];
  status?: 'ok' | 'warning' | 'critical' | 'info';
  actions?: Array<{ label: string; message: string }>;
}

/**
 * Data shape for the metric widget.
 */
export interface MetricData {
  label: string;
  value: number | string;
  unit?: string;
  trend?: 'up' | 'down' | 'flat';
  description?: string;
  previous_value?: number | string;
}
