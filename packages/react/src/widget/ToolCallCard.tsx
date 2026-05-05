/**
 * @license
 * Copyright 2025 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import { useState } from 'react';
import type { ToolCallInfo, SubagentEventInfo } from '../types';
import { FormattedText } from './FormattedText';

interface ToolCallCardProps {
  toolCall: ToolCallInfo;
  verbose?: boolean;
}

/**
 * Resolve the user-facing label for a tool call. Prefers the curated
 * `runningLabel` / `completedLabel` from the tool definition (Phase I.1 —
 * dynamic per-action copy with `{{paramName}}` placeholders pre-substituted
 * server-side), falling back to the raw tool name when none was declared.
 */
function labelFor(toolCall: ToolCallInfo): string {
  if (toolCall.status === 'running') {
    return toolCall.runningLabel ?? toolCall.toolName;
  }
  return toolCall.completedLabel ?? toolCall.runningLabel ?? toolCall.toolName;
}

function formatPayload(value: unknown): string {
  if (typeof value === 'string') return value;
  return JSON.stringify(value, null, 2);
}

// ---------------------------------------------------------------------------
// Status icon helper
// ---------------------------------------------------------------------------

function StatusIcon({ status }: { status: string }) {
  if (status === 'running') {
    return <span className="pcw-tc-icon pcw-tc-icon--running" />;
  }
  if (status === 'error') {
    return <span className="pcw-tc-icon pcw-tc-icon--error">{'\u2717'}</span>;
  }
  return <span className="pcw-tc-icon pcw-tc-icon--success">{'\u2713'}</span>;
}

// ---------------------------------------------------------------------------
// Compact mode — slim single-line rows
// ---------------------------------------------------------------------------

function CompactToolCall({ toolCall }: { toolCall: ToolCallInfo }) {
  const [expanded, setExpanded] = useState(false);
  const hasDetails = Boolean(toolCall.parameters) || Boolean(toolCall.result) || Boolean(toolCall.error);

  return (
    <div className="pcw-tc-compact">
      <button
        type="button"
        className={`pcw-tc-compact__row${hasDetails ? '' : ' pcw-tc-compact__row--static'}`}
        onClick={() => { if (hasDetails) setExpanded(!expanded); }}
      >
        <StatusIcon status={toolCall.status} />
        <span className="pcw-tc-compact__name">{labelFor(toolCall)}</span>
        {toolCall.error && <span className="pcw-tc-compact__error-hint">failed</span>}
      </button>
      {expanded && (
        <div className="pcw-tc-compact__details">
          {toolCall.error && <pre className="pcw-tc-compact__error">{toolCall.error}</pre>}
          {toolCall.parameters && (
            <pre className="pcw-tc-compact__params">{JSON.stringify(toolCall.parameters, null, 2)}</pre>
          )}
          {toolCall.result !== undefined && (
            <pre className="pcw-tc-compact__params">{formatPayload(toolCall.result)}</pre>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Compact dispatch — shows subagent activity inline
// ---------------------------------------------------------------------------

function CompactDispatch({ toolCall }: { toolCall: ToolCallInfo }) {
  const [expanded, setExpanded] = useState(false);
  const segments = buildInlineSegments(toolCall.subagentEvents);
  const toolCallCount = segments.filter((s) => s.kind === 'tool' && s.event.eventType === 'tool_call_end').length;
  const isRunning = toolCall.status === 'running';

  return (
    <div className="pcw-tc-compact">
      <button
        type="button"
        className="pcw-tc-compact__row"
        onClick={() => setExpanded(!expanded)}
      >
        <StatusIcon status={toolCall.status} />
        <span className="pcw-tc-compact__name">
          {isRunning ? 'Working...' : `Completed${toolCallCount > 0 ? ` (${String(toolCallCount)} steps)` : ''}`}
        </span>
      </button>
      {isRunning && segments.length > 0 && (
        <div className="pcw-tc-compact__activity">
          {segments.map((seg, i) =>
            seg.kind === 'text' ? (
              <FormattedText key={i} text={seg.text} className="pcw-tc-compact__thought" />
            ) : (
              <div key={i} className="pcw-tc-compact__substep">
                <StatusIcon status={seg.event.error ? 'error' : seg.event.eventType === 'tool_call_end' ? 'success' : 'running'} />
                <span className="pcw-tc-compact__name">{seg.event.toolName ?? 'unknown'}</span>
              </div>
            ),
          )}
        </div>
      )}
      {expanded && !isRunning && segments.length > 0 && (
        <div className="pcw-tc-compact__activity">
          {segments.map((seg, i) =>
            seg.kind === 'text' ? (
              <FormattedText key={i} text={seg.text} className="pcw-tc-compact__thought" />
            ) : (
              <SubagentEventRow key={i} event={seg.event} />
            ),
          )}
        </div>
      )}
      {toolCall.error && <pre className="pcw-tc-compact__error">{toolCall.error}</pre>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Verbose mode — full box UI (original design)
// ---------------------------------------------------------------------------

function VerboseToolCall({ toolCall }: { toolCall: ToolCallInfo }) {
  const [expanded, setExpanded] = useState(false);
  const statusClass = `pcw-tool-call__status pcw-tool-call__status--${toolCall.status}`;

  const label = labelFor(toolCall);
  const summary = toolCall.duration_ms
    ? `${label} (${String(toolCall.duration_ms)}ms)`
    : label;

  return (
    <div className="pcw-tool-call">
      <button
        type="button"
        className="pcw-tool-call__header"
        onClick={() => setExpanded(!expanded)}
      >
        <span className="pcw-tool-call__chevron">{expanded ? '\u25BC' : '\u25B6'}</span>
        <span className="pcw-tool-call__name">{summary}</span>
        <span className={statusClass}>{toolCall.status}</span>
      </button>
      {expanded && (
        <div className="pcw-tool-call__details">
          {toolCall.parameters && (
            <>
              <div className="pcw-tool-call__details-label">Parameters</div>
              <pre>{JSON.stringify(toolCall.parameters, null, 2)}</pre>
            </>
          )}
          {toolCall.result !== undefined && (
            <>
              <div className="pcw-tool-call__details-label">Result</div>
              <pre>{formatPayload(toolCall.result)}</pre>
            </>
          )}
        </div>
      )}
      {toolCall.error && <p className="pcw-tool-call__error">{toolCall.error}</p>}
    </div>
  );
}

function VerboseDispatch({ toolCall }: { toolCall: ToolCallInfo }) {
  const [detailsOpen, setDetailsOpen] = useState(false);
  const statusClass = `pcw-tool-call__status pcw-tool-call__status--${toolCall.status}`;

  const summary = toolCall.duration_ms
    ? `dispatch (${String(toolCall.duration_ms)}ms)`
    : 'dispatch';

  const completeEvent = toolCall.subagentEvents?.find(
    (e) => e.eventType === 'complete',
  );

  const segments = buildInlineSegments(toolCall.subagentEvents);
  const hasActivity = segments.length > 0;
  const toolCallCount = segments.filter((s) => s.kind === 'tool' && s.event.eventType === 'tool_call_end').length;
  const hasDetails = hasActivity || Boolean(completeEvent?.text);

  return (
    <div className="pcw-tool-call">
      <div className="pcw-tool-call__header pcw-tool-call__header--static">
        <span className="pcw-tool-call__name">{summary}</span>
        <span className={statusClass}>{toolCall.status}</span>
      </div>
      {toolCall.parameters && <DispatchArgs params={toolCall.parameters} />}
      {toolCall.status === 'running' && hasActivity && (
        <div className="pcw-dispatch-streaming">
          {segments.map((seg, i) =>
            seg.kind === 'text' ? (
              <FormattedText key={i} text={seg.text} />
            ) : (
              <InlineToolRow key={i} event={seg.event} />
            ),
          )}
        </div>
      )}
      {toolCall.status !== 'running' && hasDetails && (
        <div className="pcw-dispatch-details">
          <button
            type="button"
            className="pcw-dispatch-details__toggle"
            onClick={() => setDetailsOpen(!detailsOpen)}
          >
            <span className="pcw-tool-call__chevron">{detailsOpen ? '\u25BC' : '\u25B6'}</span>
            <span>details</span>
            {toolCallCount > 0 && (
              <span className="pcw-dispatch-details__count">
                {String(toolCallCount)} tool calls
              </span>
            )}
          </button>
          {detailsOpen && (
            <div className="pcw-dispatch-details__body">
              {completeEvent?.text && (
                <FormattedText text={completeEvent.text} className="pcw-tool-call__subagent-summary" />
              )}
              {segments.length > 0 && (
                <div className="pcw-tool-call__subagent">
                  {segments.map((seg, i) =>
                    seg.kind === 'text' ? (
                      <FormattedText key={i} text={seg.text} className="pcw-dispatch-inline-text" />
                    ) : (
                      <SubagentEventRow key={i} event={seg.event} />
                    ),
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      )}
      {toolCall.error && <p className="pcw-tool-call__error">{toolCall.error}</p>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Shared helpers (used by both modes)
// ---------------------------------------------------------------------------

function SubagentEventRow({ event }: { event: SubagentEventInfo }) {
  const [expanded, setExpanded] = useState(false);
  const hasDetail = Boolean(event.result || event.error || event.toolArgs);

  return (
    <div className="pcw-subagent-row">
      <button
        type="button"
        className={`pcw-subagent-row__header${hasDetail ? '' : ' pcw-subagent-row__header--static'}`}
        onClick={() => { if (hasDetail) setExpanded(!expanded); }}
      >
        {hasDetail && (
          <span className="pcw-subagent-row__chevron">{expanded ? '\u25BC' : '\u25B6'}</span>
        )}
        <span className={`pcw-subagent-row__icon${event.error ? ' pcw-subagent-row__icon--error' : ''}`}>
          {event.error ? '\u2717' : '\u2713'}
        </span>
        <span className="pcw-subagent-row__name">{event.toolName ?? 'unknown'}</span>
      </button>
      {expanded && (
        <div className="pcw-subagent-row__detail">
          {event.error && <pre className="pcw-subagent-row__error">{event.error}</pre>}
          {event.result && <pre className="pcw-subagent-row__result">{event.result}</pre>}
          {event.toolArgs && (
            <pre className="pcw-subagent-row__args">{JSON.stringify(event.toolArgs, null, 2)}</pre>
          )}
        </div>
      )}
    </div>
  );
}

function DispatchArgs({ params }: { params: Record<string, unknown> }) {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- dispatch params from server
  const subagent = params['subagent'] as string | undefined;
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- dispatch params from server
  const task = params['task'] as string | undefined;
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- dispatch params from server
  const instruction = params['instruction'] as string | undefined;
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- dispatch params from server
  const kbTags = params['kb_tags'] as string[] | undefined;
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- dispatch params from server
  const tools = params['tools'] as string[] | undefined;

  return (
    <div className="pcw-dispatch-args">
      {subagent && (
        <div className="pcw-dispatch-args__row">
          <span className="pcw-dispatch-args__label">agent</span>
          <span className="pcw-dispatch-args__value pcw-dispatch-args__value--mono">{subagent}</span>
        </div>
      )}
      {task && (
        <div className="pcw-dispatch-args__row">
          <span className="pcw-dispatch-args__label">task</span>
          <span className="pcw-dispatch-args__value">{task}</span>
        </div>
      )}
      {instruction && !task && (
        <div className="pcw-dispatch-args__row">
          <span className="pcw-dispatch-args__label">instruction</span>
          <span className="pcw-dispatch-args__value">{instruction}</span>
        </div>
      )}
      {kbTags && kbTags.length > 0 && (
        <div className="pcw-dispatch-args__row">
          <span className="pcw-dispatch-args__label">kb</span>
          <span className="pcw-dispatch-args__value pcw-dispatch-args__tags">
            {kbTags.map((t) => (
              <span key={t} className="pcw-dispatch-args__tag">{t}</span>
            ))}
          </span>
        </div>
      )}
      {tools && tools.length > 0 && (
        <div className="pcw-dispatch-args__row">
          <span className="pcw-dispatch-args__label">tools</span>
          <span className="pcw-dispatch-args__value pcw-dispatch-args__tags">
            {tools.map((t) => (
              <span key={t} className="pcw-dispatch-args__tag">{t}</span>
            ))}
          </span>
        </div>
      )}
    </div>
  );
}

type InlineSegment =
  | { kind: 'text'; text: string }
  | { kind: 'tool'; event: SubagentEventInfo };

/**
 * Collapse consecutive thought events into text blocks, keeping tool call
 * events inline between them. 'complete' and 'error' events are skipped —
 * they're handled by the caller separately.
 */
function buildInlineSegments(events: SubagentEventInfo[] | undefined): InlineSegment[] {
  if (!events || events.length === 0) return [];
  const segments: InlineSegment[] = [];
  let pendingText = '';
  for (const e of events) {
    if (e.eventType === 'thought' && e.text) {
      pendingText += e.text;
    } else if (e.eventType === 'tool_call_start' || e.eventType === 'tool_call_end') {
      if (pendingText) {
        segments.push({ kind: 'text', text: pendingText });
        pendingText = '';
      }
      segments.push({ kind: 'tool', event: e });
    }
  }
  if (pendingText) {
    segments.push({ kind: 'text', text: pendingText });
  }
  return segments;
}

function InlineToolRow({ event }: { event: SubagentEventInfo }) {
  const isEnd = event.eventType === 'tool_call_end';
  const icon = event.error ? '\u2717' : isEnd ? '\u2713' : '\u29BF';
  const iconClass = event.error
    ? 'pcw-subagent-row__icon--error'
    : isEnd
      ? ''
      : 'pcw-subagent-row__icon--running';
  return (
    <div className="pcw-subagent-inline-tool">
      <span className={`pcw-subagent-row__icon ${iconClass}`}>{icon}</span>
      <span className="pcw-subagent-row__name">{event.toolName ?? 'unknown'}</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main export — routes to compact or verbose based on prop
// ---------------------------------------------------------------------------

export function ToolCallCard({ toolCall, verbose = false }: ToolCallCardProps) {
  if (toolCall.toolName === 'dispatch') {
    return verbose
      ? <VerboseDispatch toolCall={toolCall} />
      : <CompactDispatch toolCall={toolCall} />;
  }
  return verbose
    ? <VerboseToolCall toolCall={toolCall} />
    : <CompactToolCall toolCall={toolCall} />;
}
