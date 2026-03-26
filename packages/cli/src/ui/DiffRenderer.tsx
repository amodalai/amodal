/**
 * @license
 * Copyright 2025 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import type React from 'react';
import {Box, Text} from 'ink';
import {theme} from './theme.js';

interface DiffRendererProps {
  diff: string;
  width?: number;
}

export interface DiffLine {
  type: 'context' | 'added' | 'removed';
  content: string;
  oldLine: number | null;
  newLine: number | null;
}

export interface DiffHunk {
  header: string;
  lines: DiffLine[];
  fileExt?: string;
}

/**
 * Returns true if text looks like a unified diff.
 */
export function isDiffContent(text: string): boolean {
  const lines = text.split('\n');
  // Must have at least a hunk header or --- / +++ pair
  return lines.some((l) => l.startsWith('@@')) ||
    (lines.some((l) => l.startsWith('---')) && lines.some((l) => l.startsWith('+++')));
}

/**
 * Parse a unified diff into structured hunks with line numbers.
 */
export function parseDiff(diff: string): DiffHunk[] {
  const lines = diff.split('\n');
  const hunks: DiffHunk[] = [];
  let currentHunk: DiffHunk | null = null;
  let oldLine = 0;
  let newLine = 0;
  let fileExt: string | undefined;

  for (const line of lines) {
    // Detect file extension from headers
    if (line.startsWith('--- ') || line.startsWith('+++ ')) {
      const match = /\.(\w+)$/.exec(line);
      if (match) {
        fileExt = match[1];
      }
      continue;
    }

    // Hunk header
    const hunkMatch = /^@@\s+-(\d+)(?:,\d+)?\s+\+(\d+)(?:,\d+)?\s+@@/.exec(line);
    if (hunkMatch) {
      currentHunk = {
        header: line,
        lines: [],
        fileExt,
      };
      hunks.push(currentHunk);
      oldLine = parseInt(hunkMatch[1] ?? '0', 10);
      newLine = parseInt(hunkMatch[2] ?? '0', 10);
      continue;
    }

    if (!currentHunk) continue;

    if (line.startsWith('+')) {
      currentHunk.lines.push({
        type: 'added',
        content: line.slice(1),
        oldLine: null,
        newLine: newLine++,
      });
    } else if (line.startsWith('-')) {
      currentHunk.lines.push({
        type: 'removed',
        content: line.slice(1),
        oldLine: oldLine++,
        newLine: null,
      });
    } else {
      // Context line (starts with space or is empty)
      currentHunk.lines.push({
        type: 'context',
        content: line.startsWith(' ') ? line.slice(1) : line,
        oldLine: oldLine++,
        newLine: newLine++,
      });
    }
  }

  return hunks;
}

function formatLineNum(n: number | null, width: number): string {
  if (n === null) return ' '.repeat(width);
  return String(n).padStart(width);
}

export const DiffRenderer: React.FC<DiffRendererProps> = ({diff, width}) => {
  const hunks = parseDiff(diff);

  // Fallback to simple rendering if parsing fails
  if (hunks.length === 0) {
    const lines = diff.split('\n');
    return (
      <Box flexDirection="column">
        {lines.map((line, i) => {
          const color = line.startsWith('+')
            ? theme.status.success
            : line.startsWith('-')
              ? theme.status.error
              : line.startsWith('@@')
                ? theme.text.link
                : theme.text.secondary;
          return (
            <Text key={i} color={color}>
              {line}
            </Text>
          );
        })}
      </Box>
    );
  }

  // Calculate gutter width
  let maxLine = 0;
  for (const hunk of hunks) {
    for (const line of hunk.lines) {
      if (line.oldLine !== null && line.oldLine > maxLine) maxLine = line.oldLine;
      if (line.newLine !== null && line.newLine > maxLine) maxLine = line.newLine;
    }
  }
  const gutterWidth = Math.max(3, String(maxLine).length);
  const showGutter = (width ?? 80) > 60;

  return (
    <Box flexDirection="column">
      {hunks.map((hunk, hi) => (
        <Box key={hi} flexDirection="column">
          {/* Gap indicator between non-contiguous hunks */}
          {hi > 0 ? (
            <Text color={theme.ui.dim}>{'  ···'}</Text>
          ) : null}

          {/* Hunk header */}
          <Text color={theme.text.link}>{hunk.header}</Text>

          {/* Lines */}
          {hunk.lines.map((line, li) => {
            const color =
              line.type === 'added'
                ? theme.status.success
                : line.type === 'removed'
                  ? theme.status.error
                  : theme.text.secondary;
            const prefix =
              line.type === 'added' ? '+' : line.type === 'removed' ? '-' : ' ';

            return (
              <Box key={li}>
                {showGutter ? (
                  <Text color={theme.ui.dim}>
                    {formatLineNum(line.oldLine, gutterWidth)}{' '}
                    {formatLineNum(line.newLine, gutterWidth)}{' '}
                  </Text>
                ) : null}
                <Text color={color}>
                  {prefix}
                  {line.content}
                </Text>
              </Box>
            );
          })}
        </Box>
      ))}
    </Box>
  );
};
