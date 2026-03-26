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
 * SSE events that include a tool call.
 */
export const toolCallSSEEvents: Array<Record<string, unknown>> = [
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

export const chatHandlers = [
  http.post('http://localhost:4555/chat/stream', () =>
    new HttpResponse(encodeSSEEvents(defaultSSEEvents), {
      headers: { 'Content-Type': 'text/event-stream' },
    }),
  ),

  http.post('http://localhost:4555/sessions', () =>
    HttpResponse.json({
      session_id: 'test-session-1',
      role: 'analyst',
    }),
  ),
];
