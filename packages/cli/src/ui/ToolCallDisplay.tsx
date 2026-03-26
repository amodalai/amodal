/**
 * @license
 * Copyright 2025 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import type React from 'react';
import {useState} from 'react';
import {Box, Text, useInput} from 'ink';
import Spinner from 'ink-spinner';
import {theme} from './theme.js';
import {SubagentDisplay} from './SubagentDisplay.js';
import {DiffRenderer, isDiffContent} from './DiffRenderer.js';
import type {ToolCallInfo} from './types.js';

interface ToolCallDisplayProps {
  tool: ToolCallInfo;
  width?: number;
  /** Render as a compact expandable card (for finalized messages) */
  compact?: boolean;
}

function getStatusIcon(status: 'running' | 'success' | 'error'): React.ReactNode {
  switch (status) {
    case 'running':
      return <Spinner type="dots" />;
    case 'success':
      return <Text color={theme.status.success}>{'\u2713'}</Text>;
    case 'error':
      return <Text color={theme.status.error}>{'\u2717'}</Text>;
    default:
      return <Spinner type="dots" />;
  }
}

function getBorderColor(status: 'running' | 'success' | 'error'): string {
  switch (status) {
    case 'running':
      return theme.border.focused;
    case 'success':
      return theme.border.default;
    case 'error':
      return theme.status.error;
    default:
      return theme.border.default;
  }
}

function formatArgs(args: Record<string, unknown>): string {
  const entries = Object.entries(args);
  if (entries.length === 0) return '';
  const parts = entries.map(([k, v]) => {
    const val = typeof v === 'string' ? v : JSON.stringify(v);
    const short = val && val.length > 40 ? val.slice(0, 40) + '\u2026' : val;
    return `${k}=${short}`;
  });
  return parts.join(' ');
}

function formatResultInline(result: string, maxLen = 60): string {
  const oneLine = result.replace(/\n/g, ' ').trim();
  return oneLine.length > maxLen ? oneLine.slice(0, maxLen) + '\u2026' : oneLine;
}

/**
 * Build a short human-readable description of what the tool call did.
 */
function describeToolCall(toolName: string, args: Record<string, unknown>): string {
  if (toolName === 'request') {
    const method = args['method'] ?? 'GET';
    const endpoint = args['endpoint'] ?? '';
    const connection = args['connection'] ?? '';
    const parts = [String(method), String(endpoint)];
    if (connection) parts.push(`via ${String(connection)}`);
    return parts.join(' ');
  }
  if (toolName === 'explore' || toolName === 'amodal_explore') {
    const query = args['query'];
    return query ? `"${String(query).slice(0, 50)}"` : '';
  }
  if (toolName === 'dispatch') {
    const task = args['task'] ?? args['description'] ?? '';
    return task ? String(task).slice(0, 50) : '';
  }
  const entries = Object.entries(args);
  if (entries.length === 0) return '';
  const [key, val] = entries[0] ?? ['', ''];
  const valStr = typeof val === 'string' ? val : JSON.stringify(val);
  const short = valStr.length > 40 ? valStr.slice(0, 40) + '\u2026' : valStr;
  return `${key}=${short}`;
}

/**
 * Format full args as key=value lines for expanded view.
 */
function formatArgsExpanded(args: Record<string, unknown>): string[] {
  return Object.entries(args).map(([k, v]) => {
    const val = typeof v === 'string' ? v : JSON.stringify(v, null, 2);
    return `${k}: ${val}`;
  });
}

function renderFullResult(result: string, width?: number): React.ReactNode {
  if (isDiffContent(result)) {
    return <DiffRenderer diff={result} width={width} />;
  }
  return (
    <Text color={theme.text.secondary} wrap="wrap">
      {result}
    </Text>
  );
}

/**
 * Compact expandable tool call card.
 *
 * Collapsed:
 *   ╭────────────────────────────────────────────╮
 *   │ ✓ request GET /api/components (245ms)   ▸  │
 *   │   {"id":"api","status":"operational"...    │
 *   ╰────────────────────────────────────────────╯
 *
 * Expanded:
 *   ╭────────────────────────────────────────────╮
 *   │ ✓ request GET /api/components (245ms)   ▾  │
 *   │                                            │
 *   │ Arguments:                                 │
 *   │   connection: statuspage                   │
 *   │   method: GET                              │
 *   │   endpoint: /api/components                │
 *   │                                            │
 *   │ Response:                                  │
 *   │   [{"id":"api","name":"API Gateway",...}]  │
 *   ╰────────────────────────────────────────────╯
 */
const CompactToolCall: React.FC<ToolCallDisplayProps> = ({tool, width}) => {
  const [expanded, setExpanded] = useState(false);
  const borderColor = getBorderColor(tool.status);
  const durationStr = tool.durationMs !== undefined ? `(${tool.durationMs}ms)` : '';
  const description = describeToolCall(tool.toolName, tool.args);
  const hasDetails = Object.keys(tool.args).length > 0 || (tool.result && tool.result.length > 70) || tool.error;

  useInput((_input, key) => {
    if (key.ctrl && _input === 'e' && hasDetails) {
      setExpanded((prev) => !prev);
    }
  });

  return (
    <Box flexDirection="column" marginLeft={2}>
      <Box
        borderStyle="round"
        borderColor={borderColor}
        flexDirection="column"
        paddingLeft={1}
        paddingRight={1}
        width={width ? Math.min(width - 4, 80) : undefined}
      >
        {/* Header line */}
        <Box>
          {getStatusIcon(tool.status)}
          <Text> </Text>
          <Text bold color={theme.text.primary}>{tool.toolName}</Text>
          {description ? (
            <Text color={theme.text.secondary}> {description}</Text>
          ) : null}
          {durationStr ? (
            <Text color={theme.ui.dim}> {durationStr}</Text>
          ) : null}
          {hasDetails ? (
            <Text color={theme.ui.dim}> {expanded ? '\u25BE' : '\u25B8'}</Text>
          ) : null}
        </Box>

        {expanded ? (
          <>
            {/* Expanded: full args */}
            {Object.keys(tool.args).length > 0 ? (
              <Box flexDirection="column" marginTop={1}>
                <Text color={theme.ui.dim} bold>Arguments:</Text>
                {formatArgsExpanded(tool.args).map((line, i) => (
                  <Box key={i} marginLeft={2}>
                    <Text color={theme.text.secondary}>{line}</Text>
                  </Box>
                ))}
              </Box>
            ) : null}

            {/* Expanded: full result */}
            {tool.result ? (
              <Box flexDirection="column" marginTop={1}>
                <Text color={theme.ui.dim} bold>Response:</Text>
                <Box marginLeft={2}>
                  {renderFullResult(tool.result, width ? width - 10 : undefined)}
                </Box>
              </Box>
            ) : null}

            {/* Expanded: full error */}
            {tool.error ? (
              <Box flexDirection="column" marginTop={1}>
                <Text color={theme.ui.dim} bold>Error:</Text>
                <Box marginLeft={2}>
                  <Text color={theme.status.error} wrap="wrap">{tool.error}</Text>
                </Box>
              </Box>
            ) : null}
          </>
        ) : (
          <>
            {/* Collapsed: one-line preview */}
            {tool.error ? (
              <Text color={theme.status.error}>{tool.error.length > 70 ? tool.error.slice(0, 70) + '\u2026' : tool.error}</Text>
            ) : tool.result ? (
              <Text color={theme.ui.dim}>{formatResultInline(tool.result, 70)}</Text>
            ) : null}
          </>
        )}
      </Box>
    </Box>
  );
};

/**
 * Full bordered display (used during streaming for active/running tools).
 */
const FullToolCall: React.FC<ToolCallDisplayProps> = ({tool, width}) => {
  const borderColor = getBorderColor(tool.status);
  const argsStr = formatArgs(tool.args);
  const durationStr = tool.durationMs !== undefined ? ` ${tool.durationMs}ms` : '';

  return (
    <Box flexDirection="column" marginLeft={2}>
      <Box
        borderStyle="round"
        borderColor={borderColor}
        flexDirection="column"
        paddingLeft={1}
        paddingRight={1}
        width={width ? Math.min(width - 4, 80) : undefined}
      >
        <Box>
          {getStatusIcon(tool.status)}
          <Text> </Text>
          <Text bold color={theme.text.primary}>
            {tool.toolName}
          </Text>
          {argsStr ? (
            <Text color={theme.text.secondary}> {argsStr}</Text>
          ) : null}
          {durationStr ? (
            <Text color={theme.ui.dim}>{durationStr}</Text>
          ) : null}
        </Box>
        {tool.result ? renderFullResult(tool.result, width) : null}
        {tool.error ? (
          <Text color={theme.status.error}>{tool.error}</Text>
        ) : null}
      </Box>
      {tool.subagentEvents && tool.subagentEvents.length > 0 ? (
        <SubagentDisplay events={tool.subagentEvents} />
      ) : null}
    </Box>
  );
};

export const ToolCallDisplay: React.FC<ToolCallDisplayProps> = (props) =>
  props.compact ? <CompactToolCall {...props} /> : <FullToolCall {...props} />;
