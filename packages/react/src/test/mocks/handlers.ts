/**
 * @license
 * Copyright 2025 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import { http, HttpResponse } from 'msw';

/**
 * Encodes SSE events as a string for streaming responses.
 */
export function encodeSSEEvents(events: Array<Record<string, unknown>>): string {
  return events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join('');
}

// ---------------------------------------------------------------------------
// Chat-widget style SSE events (targeting /chat/stream on WIDGET_URL)
// ---------------------------------------------------------------------------

const WIDGET_URL = 'http://localhost:4555';

/**
 * Default SSE events for a basic chat response.
 */
export const defaultSSEEvents: Array<Record<string, unknown>> = [
  { type: 'init', session_id: 'test-session-1', timestamp: new Date().toISOString() },
  { type: 'text_delta', content: 'Hello, ', timestamp: new Date().toISOString() },
  { type: 'text_delta', content: 'world!', timestamp: new Date().toISOString() },
  { type: 'done', timestamp: new Date().toISOString() },
];

/**
 * SSE events that include a tool call (runtime-style, used by useAmodalChat tests).
 */
export const toolCallSSEEvents: Array<Record<string, unknown>> = [
  { type: 'init', session_id: 'test-session-2', timestamp: '2025-01-01T00:00:00.000Z' },
  { type: 'text_delta', content: 'Let me check... ', timestamp: '2025-01-01T00:00:01.000Z' },
  {
    type: 'tool_call_start',
    tool_id: 'tc-1',
    tool_name: 'request',
    parameters: { url: 'http://localhost/api/data' },
    timestamp: '2025-01-01T00:00:02.000Z',
  },
  {
    type: 'tool_call_result',
    tool_id: 'tc-1',
    status: 'success',
    result: '{"data": [1, 2, 3]}',
    duration_ms: 150,
    timestamp: '2025-01-01T00:00:03.000Z',
  },
  { type: 'text_delta', content: 'Found 3 items.', timestamp: '2025-01-01T00:00:04.000Z' },
  { type: 'done', timestamp: '2025-01-01T00:00:05.000Z' },
];

/**
 * SSE events that include a tool call (widget-style, used by useChat/ChatWidget tests).
 */
export const widgetToolCallSSEEvents: Array<Record<string, unknown>> = [
  { type: 'init', session_id: 'test-session-2', timestamp: new Date().toISOString() },
  { type: 'text_delta', content: 'Let me check... ', timestamp: new Date().toISOString() },
  {
    type: 'tool_call_start',
    tool_id: 'tc-1',
    tool_name: 'shell_exec',
    parameters: { command: 'curl http://localhost:4444/devices?zone=C' },
    timestamp: new Date().toISOString(),
  },
  {
    type: 'tool_call_result',
    tool_id: 'tc-1',
    status: 'success',
    timestamp: new Date().toISOString(),
  },
  { type: 'text_delta', content: 'Found 3 devices.', timestamp: new Date().toISOString() },
  { type: 'done', timestamp: new Date().toISOString() },
];

/**
 * SSE events that include skill activation and KB proposal.
 */
export const skillAndKBSSEEvents: Array<Record<string, unknown>> = [
  { type: 'init', session_id: 'test-session-3', timestamp: new Date().toISOString() },
  { type: 'skill_activated', skill: 'triage', timestamp: new Date().toISOString() },
  { type: 'text_delta', content: 'Investigating... ', timestamp: new Date().toISOString() },
  {
    type: 'kb_proposal',
    scope: 'segment',
    title: 'Rogue sensor in Zone C',
    reasoning: 'Discovered new pattern during investigation',
    timestamp: new Date().toISOString(),
  },
  { type: 'text_delta', content: 'Done.', timestamp: new Date().toISOString() },
  { type: 'done', timestamp: new Date().toISOString() },
];

/**
 * SSE events that include a widget event.
 */
export const widgetSSEEvents: Array<Record<string, unknown>> = [
  { type: 'init', session_id: 'test-session-4', timestamp: new Date().toISOString() },
  { type: 'text_delta', content: 'I found a suspicious device.\n\n', timestamp: new Date().toISOString() },
  {
    type: 'widget',
    widget_type: 'entity-card',
    data: {
      mac: 'AA:BB:CC:DD:EE:01',
      manufacturer: 'Espressif',
      protocols: ['wifi_2.4', 'zigbee'],
      zone: 'C',
      zone_name: 'Server Room',
      suspicion_score: 87,
      score_factors: { unknown_manufacturer: 20, no_entry_trajectory: 25, restricted_zone: 20 },
      tag_status: 'untagged',
      dwell_time_minutes: 30,
    },
    timestamp: new Date().toISOString(),
  },
  { type: 'text_delta', content: 'This is likely a rogue sensor.', timestamp: new Date().toISOString() },
  {
    type: 'widget',
    widget_type: 'scope-map',
    data: {
      highlight_zones: ['C'],
      highlight_devices: ['AA:BB:CC:DD:EE:01'],
      label: 'Rogue sensor location',
    },
    timestamp: new Date().toISOString(),
  },
  { type: 'done', timestamp: new Date().toISOString() },
];

// ---------------------------------------------------------------------------
// Runtime-style SSE events (targeting /chat on RUNTIME_URL)
// ---------------------------------------------------------------------------

const RUNTIME_URL = 'http://localhost:3001';
export const RUNTIME_TEST_URL = RUNTIME_URL;

/**
 * SSE events with a confirmation_required event.
 */
export const confirmationSSEEvents: Array<Record<string, unknown>> = [
  { type: 'init', session_id: 'test-session-3', timestamp: '2025-01-01T00:00:00.000Z' },
  { type: 'text_delta', content: 'I need to make a POST request. ', timestamp: '2025-01-01T00:00:01.000Z' },
  {
    type: 'confirmation_required',
    endpoint: '/api/tickets',
    method: 'POST',
    reason: 'Creating a new ticket requires confirmation',
    escalated: false,
    params: { title: 'Bug fix' },
    connection_name: 'jira',
    correlation_id: 'confirm-1',
    timestamp: '2025-01-01T00:00:02.000Z',
  },
  { type: 'done', timestamp: '2025-01-01T00:00:03.000Z' },
];

/**
 * SSE events with explore and plan mode.
 */
export const explorePlanSSEEvents: Array<Record<string, unknown>> = [
  { type: 'init', session_id: 'test-session-4', timestamp: '2025-01-01T00:00:00.000Z' },
  { type: 'explore_start', query: 'What data sources are available?', timestamp: '2025-01-01T00:00:01.000Z' },
  { type: 'explore_end', summary: 'Found 3 data sources', tokens_used: 500, timestamp: '2025-01-01T00:00:02.000Z' },
  { type: 'plan_mode', action: 'enter', plan: 'Step 1: Query API\nStep 2: Analyze data', timestamp: '2025-01-01T00:00:03.000Z' },
  { type: 'text_delta', content: 'Here is the analysis.', timestamp: '2025-01-01T00:00:04.000Z' },
  { type: 'done', timestamp: '2025-01-01T00:00:05.000Z' },
];

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

export const chatHandlers = [
  // Widget-style chat endpoint
  http.post(`${WIDGET_URL}/chat/stream`, () =>
    new HttpResponse(encodeSSEEvents(defaultSSEEvents), {
      headers: { 'Content-Type': 'text/event-stream' },
    }),
  ),

  http.post(`${WIDGET_URL}/sessions`, () =>
    HttpResponse.json({
      session_id: 'test-session-1',
    }),
  ),

  // Runtime-style chat endpoint
  http.post(`${RUNTIME_URL}/chat`, () =>
    new HttpResponse(encodeSSEEvents(defaultSSEEvents), {
      headers: { 'Content-Type': 'text/event-stream' },
    }),
  ),

  http.post(`${RUNTIME_URL}/task`, () =>
    HttpResponse.json({ task_id: 'task-1' }, { status: 202 }),
  ),

  http.get(`${RUNTIME_URL}/task/task-1`, () =>
    HttpResponse.json({
      task_id: 'task-1',
      status: 'completed',
      event_count: 4,
      created_at: Date.now(),
    }),
  ),

  http.get(`${RUNTIME_URL}/task/task-1/stream`, () =>
    new HttpResponse(encodeSSEEvents(defaultSSEEvents), {
      headers: { 'Content-Type': 'text/event-stream' },
    }),
  ),
];
