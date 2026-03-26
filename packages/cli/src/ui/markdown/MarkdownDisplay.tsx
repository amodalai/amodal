/**
 * @license
 * Copyright 2025 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import type React from 'react';
import {Box, Text} from 'ink';
import {theme} from '../theme.js';
import {InlineRenderer} from './InlineRenderer.js';
import {CodeBlock} from './CodeBlock.js';
import {Table} from './Table.js';

interface MarkdownDisplayProps {
  text: string;
  width?: number;
}

interface ParseState {
  inCodeBlock: boolean;
  codeLanguage: string;
  codeLines: string[];
  inTable: boolean;
  tableHeaders: string[];
  tableRows: string[][];
}

function parseTableRow(line: string): string[] {
  return line
    .split('|')
    .slice(1, -1)
    .map((cell) => cell.trim());
}

function isTableSeparator(line: string): boolean {
  return /^\|[\s:]*-+[\s:]*(\|[\s:]*-+[\s:]*)*\|$/.test(line.trim());
}

/**
 * Line-by-line markdown parser and renderer.
 * Supports: code blocks, tables, headings, lists, horizontal rules, inline formatting.
 */
export const MarkdownDisplay: React.FC<MarkdownDisplayProps> = ({
  text,
  width,
}) => {
  const lines = text.split('\n');
  const blocks: React.ReactNode[] = [];
  let blockKey = 0;

  const state: ParseState = {
    inCodeBlock: false,
    codeLanguage: '',
    codeLines: [],
    inTable: false,
    tableHeaders: [],
    tableRows: [],
  };

  const flushTable = () => {
    if (state.tableHeaders.length > 0) {
      blocks.push(
        <Table
          key={blockKey++}
          headers={state.tableHeaders}
          rows={state.tableRows}
          width={width}
        />,
      );
    }
    state.inTable = false;
    state.tableHeaders = [];
    state.tableRows = [];
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';

    // Code fence toggle
    if (/^```/.test(line.trim())) {
      if (state.inCodeBlock) {
        // End code block
        blocks.push(
          <CodeBlock
            key={blockKey++}
            code={state.codeLines.join('\n')}
            language={state.codeLanguage}
            width={width}
          />,
        );
        state.inCodeBlock = false;
        state.codeLines = [];
        state.codeLanguage = '';
      } else {
        // Flush table if in one
        if (state.inTable) flushTable();
        // Start code block
        state.inCodeBlock = true;
        state.codeLanguage = line.trim().slice(3).trim();
      }
      continue;
    }

    // Inside code block — accumulate
    if (state.inCodeBlock) {
      state.codeLines.push(line);
      continue;
    }

    // Table handling
    if (line.trim().startsWith('|') && line.trim().endsWith('|')) {
      if (!state.inTable) {
        // Could be header row
        const nextLine = lines[i + 1] ?? '';
        if (isTableSeparator(nextLine)) {
          state.inTable = true;
          state.tableHeaders = parseTableRow(line);
          i++; // Skip separator line
          continue;
        }
      }
      if (state.inTable) {
        if (!isTableSeparator(line)) {
          state.tableRows.push(parseTableRow(line));
        }
        continue;
      }
    } else if (state.inTable) {
      flushTable();
    }

    // Horizontal rule
    if (/^(\s*[-*_]\s*){3,}$/.test(line)) {
      blocks.push(
        <Box key={blockKey++} marginY={0}>
          <Text color={theme.ui.dim}>{'─'.repeat(Math.min(width ?? 60, 60))}</Text>
        </Box>,
      );
      continue;
    }

    // Headings
    const headingMatch = /^(#{1,4})\s+(.+)$/.exec(line);
    if (headingMatch) {
      const level = headingMatch[1]?.length ?? 1;
      const headingText = headingMatch[2] ?? '';
      const colors: Record<number, string> = {
        1: theme.text.accent,
        2: theme.text.accent,
        3: theme.text.primary,
        4: theme.text.secondary,
      };
      blocks.push(
        <Box key={blockKey++} marginTop={level <= 2 ? 1 : 0}>
          <Text bold color={colors[level] ?? theme.text.primary}>
            {headingText}
          </Text>
        </Box>,
      );
      continue;
    }

    // Unordered list
    const ulMatch = /^(\s*)[*+-]\s+(.+)$/.exec(line);
    if (ulMatch) {
      const indent = Math.floor((ulMatch[1]?.length ?? 0) / 2);
      const content = ulMatch[2] ?? '';
      blocks.push(
        <Box key={blockKey++} paddingLeft={indent * 2}>
          <Text color={theme.text.accent}>{'•'} </Text>
          <InlineRenderer text={content} />
        </Box>,
      );
      continue;
    }

    // Ordered list
    const olMatch = /^(\s*)\d+\.\s+(.+)$/.exec(line);
    if (olMatch) {
      const indent = Math.floor((olMatch[1]?.length ?? 0) / 2);
      const content = olMatch[2] ?? '';
      const numMatch = /^(\s*\d+)\./.exec(line);
      const num = numMatch?.[1]?.trim() ?? '1';
      blocks.push(
        <Box key={blockKey++} paddingLeft={indent * 2}>
          <Text color={theme.text.secondary}>{num}. </Text>
          <InlineRenderer text={content} />
        </Box>,
      );
      continue;
    }

    // Empty line
    if (line.trim() === '') {
      blocks.push(<Text key={blockKey++}>{' '}</Text>);
      continue;
    }

    // Regular paragraph with inline formatting
    blocks.push(
      <Box key={blockKey++}>
        <InlineRenderer text={line} />
      </Box>,
    );
  }

  // Flush any remaining table
  if (state.inTable) flushTable();

  // Flush any unclosed code block
  if (state.inCodeBlock && state.codeLines.length > 0) {
    blocks.push(
      <CodeBlock
        key={blockKey++}
        code={state.codeLines.join('\n')}
        language={state.codeLanguage}
        width={width}
      />,
    );
  }

  return <Box flexDirection="column">{blocks}</Box>;
};
