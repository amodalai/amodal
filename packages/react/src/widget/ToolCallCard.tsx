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
}

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
          <span className="pcw-subagent-row__chevron">{expanded ? '▼' : '▶'}</span>
        )}
        <span className={`pcw-subagent-row__icon${event.error ? ' pcw-subagent-row__icon--error' : ''}`}>
          {event.error ? '✗' : '✓'}
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

/** Format dispatch parameters into a readable args summary. */
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

/**
 * Collapse consecutive thought events into text blocks, keeping tool call
 * events inline between them. Returns an ordered list of render segments.
 */
type InlineSegment =
  | { kind: 'text'; text: string }
  | { kind: 'tool'; event: SubagentEventInfo };

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
    // skip 'complete' and 'error' — handled separately
  }
  if (pendingText) {
    segments.push({ kind: 'text', text: pendingText });
  }
  return segments;
}

/** Render an inline tool call row (for running subagent events). */
function InlineToolRow({ event }: { event: SubagentEventInfo }) {
  const isEnd = event.eventType === 'tool_call_end';
  const icon = event.error ? '✗' : isEnd ? '✓' : '⦿';
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

function DispatchToolCallCard({ toolCall }: ToolCallCardProps) {
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
            <span className="pcw-tool-call__chevron">{detailsOpen ? '▼' : '▶'}</span>
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

export function ToolCallCard({ toolCall }: ToolCallCardProps) {
  const [expanded, setExpanded] = useState(false);

  // Use the specialized layout for dispatch tool calls
  if (toolCall.toolName === 'dispatch') {
    return <DispatchToolCallCard toolCall={toolCall} />;
  }
  const statusClass = `pcw-tool-call__status pcw-tool-call__status--${toolCall.status}`;

  // Prefer the friendly running/completed labels when the tool definition
  // provides them. Fall back to the raw tool name so tools that haven't
  // declared labels keep working unchanged.
  const friendlyLabel =
    toolCall.status === 'running'
      ? toolCall.runningLabel ?? toolCall.toolName
      : (toolCall.completedLabel ?? toolCall.runningLabel ?? toolCall.toolName);

  const summary = toolCall.duration_ms
    ? `${friendlyLabel} (${String(toolCall.duration_ms)}ms)`
    : friendlyLabel;

  // Build timeline entries: arguments → (log) → result/error. Each
  // entry renders as a small bullet on a vertical rail when expanded;
  // no background panel, just indented text.
  const hasArgs = toolCall.parameters && Object.keys(toolCall.parameters).length > 0;
  const timelineEntries: Array<{label: string; data?: string; tone?: 'error'}> = [];
  if (hasArgs) {
    timelineEntries.push({label: 'Called', data: formatJson(toolCall.parameters)});
  } else {
    timelineEntries.push({label: 'Called'});
  }
  if (toolCall.logMessage) {
    timelineEntries.push({label: 'Logged', data: toolCall.logMessage});
  }
  if (toolCall.error) {
    timelineEntries.push({label: 'Errored', data: toolCall.error, tone: 'error'});
  } else if (toolCall.status === 'success' && toolCall.result !== undefined) {
    timelineEntries.push({label: 'Returned', data: formatResult(toolCall.result)});
  }

  return (
    <div className="pcw-tool-call">
      <button
        type="button"
        className="pcw-tool-call__header"
        onClick={() => setExpanded(!expanded)}
      >
        <span className={statusClass} aria-label={toolCall.status}>
          <StatusIcon status={toolCall.status} />
        </span>
        <span className="pcw-tool-call__name">{summary}</span>
        <span className="pcw-tool-call__chevron" aria-hidden="true">
          {expanded ? <ChevronDownIcon /> : <ChevronRightIcon />}
        </span>
      </button>
      {expanded && (
        <ol className="pcw-tool-call__timeline">
          {timelineEntries.map((entry, i) => (
            <li
              key={i}
              className={`pcw-tool-call__timeline-event${entry.tone === 'error' ? ' pcw-tool-call__timeline-event--error' : ''}`}
            >
              <span className="pcw-tool-call__timeline-label">{entry.label}</span>
              {entry.data && (
                <pre className="pcw-tool-call__timeline-data">{entry.data}</pre>
              )}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

function formatJson(value: Record<string, unknown>): string {
  return JSON.stringify(value, null, 2);
}

function formatResult(value: unknown): string {
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

// ---------------------------------------------------------------------------
// Icons (inline SVG — Lucide paths, MIT-licensed)
//
// Inline so @amodalai/react stays dependency-light. All sized via the
// containing `<span>` font-size + currentColor so the icons inherit
// alignment and color from CSS instead of hardcoded pixel values.
// ---------------------------------------------------------------------------

function ChevronRightIcon() {
  // Filled right-pointing triangle (matches the ▸ glyph). Closed
  // path with currentColor fill so it inherits the wrapper opacity.
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M9 6 l6 6 -6 6 z" />
    </svg>
  );
}

function ChevronDownIcon() {
  // Filled down-pointing triangle — same family as the right one.
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M6 9 l6 6 6 -6 z" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}

function XIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M18 6 6 18" />
      <path d="m6 6 12 12" />
    </svg>
  );
}

function RunningDotIcon() {
  // Pulsing filled circle for in-flight calls. The pulse animation
  // lives in widget.css so it can be toggled by prefers-reduced-motion.
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <circle cx="12" cy="12" r="5" />
    </svg>
  );
}

function StatusIcon({ status }: { status: 'running' | 'success' | 'error' }) {
  if (status === 'success') return <CheckIcon />;
  if (status === 'error') return <XIcon />;
  return <RunningDotIcon />;
}
