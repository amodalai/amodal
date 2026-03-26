/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import type { ToolDefinition } from '../tool-definition-types.js';
import {
  PROPOSE_KNOWLEDGE_TOOL_NAME,
  PRESENT_TOOL_NAME,
  REQUEST_TOOL_NAME,
} from '../amodal-tool-names.js';

// ============================================================================
// PROPOSE_KNOWLEDGE TOOL
// ============================================================================

export function getProposeKnowledgeDefinition(): ToolDefinition {
  return {
    base: {
      name: PROPOSE_KNOWLEDGE_TOOL_NAME,
      description:
        `Propose a knowledge base update. Use when you discover a new pattern, learn domain context from the analyst, notice a gap in the knowledge base, find outdated information, or want to record working memory for future sessions. Choose 'application' scope for knowledge that applies to all tenants, 'tenant' for knowledge specific to this deployment. Working memory is always tenant-scoped.

When to propose:
- New false positive discovered → category: false_positives
- New risk pattern identified → category: patterns
- Baseline shift detected → category: baselines
- Session notes for future reference → category: working_memory (always tenant-scoped)

Working memory is for session-to-session continuity. Formal categories (patterns, false_positives, etc.) are for permanent knowledge. Do not use this for analyst preferences — use save_memory instead.`,
      parametersJsonSchema: {
        type: 'object',
        properties: {
          action: {
            type: 'string',
            enum: ['create', 'update'],
            description:
              'Create a new document or update an existing one.',
          },
          scope: {
            type: 'string',
            enum: ['application', 'tenant'],
            description:
              'application = shared across all tenants (universal patterns, product knowledge). tenant = specific to this deployment (local incidents, environment details, working memory).',
          },
          document_id: {
            type: 'string',
            description:
              'For updates: ID of the document to update. Omit for new documents.',
          },
          title: {
            type: 'string',
            description: 'Title of the proposed document.',
          },
          category: {
            type: 'string',
            enum: [
              'system_docs',
              'methodology',
              'patterns',
              'false_positives',
              'response_procedures',
              'environment',
              'baselines',
              'team',
              'incident_history',
              'working_memory',
            ],
            description:
              'Category for the document. Application-level: system_docs, methodology, patterns, false_positives, response_procedures. Tenant-level: environment, baselines, team, incident_history, working_memory.',
          },
          body: {
            type: 'string',
            description: 'The proposed content.',
          },
          reasoning: {
            type: 'string',
            description:
              'Why you are proposing this — what did you discover or what gap did you notice?',
          },
        },
        required: [
          'action',
          'scope',
          'title',
          'category',
          'body',
          'reasoning',
        ],
      },
    },
  };
}

// ============================================================================
// PRESENT TOOL
// ============================================================================

export function getPresentToolDefinition(): ToolDefinition {
  return {
    base: {
      name: PRESENT_TOOL_NAME,
      description:
        `Show a visual widget inline in the conversation. Use to display entities, maps, alerts, timelines, score breakdowns, status boards, credential input forms, document previews, and other structured data visually instead of describing them in text.

Before first use in a session, load knowledge tagged widget_schemas for the correct data format for each widget type.

Widget selection:
- entity-card: Single entity profile or lookup result
- entity-list: Multiple entities in table format
- alert-card: Individual finding or alert with severity
- timeline: Chronological event sequence
- data-table: Structured data, comparisons, lists
- scope-map: Spatial/scope visualization
- comparison: Side-by-side entity or metric comparison
- score-breakdown: Risk/severity score with factor breakdown
- status-board: Overview of all active findings with severity
- credential-input: Securely capture connection credentials
- document-preview: Show proposed resources for approval
- info-card: Generic entity/object profile with key-value fields
- metric: Single highlighted metric with optional trend`,
      parametersJsonSchema: {
        type: 'object',
        properties: {
          widget: {
            type: 'string',
            enum: [
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
            ],
            description: 'Widget type to render.',
          },
          data: {
            type: 'object',
            description: 'Widget-specific data. Schema depends on widget type.',
          },
        },
        required: ['widget', 'data'],
      },
    },
  };
}

// ============================================================================
// REQUEST TOOL
// ============================================================================

export function getRequestToolDefinition(): ToolDefinition {
  return {
    base: {
      name: REQUEST_TOOL_NAME,
      description:
        `Make an HTTP request to a connected system. Use intent "read" for GET/query operations. For write operations (POST/PUT/PATCH/DELETE that modify data), first call with intent "write" to preview what will be executed. Present the preview to the user and ask for confirmation. Once confirmed, call again with intent "confirmed_write" to execute.

If the API returns an error:
- 401/403: Connection credentials may be invalid or expired — report to analyst
- 404: Endpoint may not exist — load system_docs to verify correct path
- 429: Rate limited — reduce query scope or wait before retrying
- 500+: Server error — try alternative endpoint, do not retry immediately`,
      parametersJsonSchema: {
        type: 'object',
        properties: {
          connection: {
            type: 'string',
            description:
              'Name of the connection to use (e.g., "datadog", "slack").',
          },
          method: {
            type: 'string',
            enum: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
            description: 'HTTP method.',
          },
          endpoint: {
            type: 'string',
            description:
              'Relative API path (e.g., "/monitors", "/api/v1/events").',
          },
          params: {
            type: 'object',
            additionalProperties: { type: 'string' },
            description: 'Query parameters as key-value pairs.',
          },
          data: {
            description: 'Request body (for POST/PUT/PATCH).',
          },
          headers: {
            type: 'object',
            additionalProperties: { type: 'string' },
            description: 'Additional HTTP headers.',
          },
          intent: {
            type: 'string',
            enum: ['read', 'write', 'confirmed_write'],
            description:
              '"read" executes immediately. "write" returns a preview without executing — present it to the user for confirmation. "confirmed_write" executes after user approval.',
          },
        },
        required: ['connection', 'method', 'endpoint', 'intent'],
      },
    },
  };
}
