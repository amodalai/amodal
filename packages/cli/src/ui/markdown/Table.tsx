/**
 * @license
 * Copyright 2025 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import type React from 'react';
import {Fragment} from 'react';
import {Box, Text} from 'ink';
import {theme} from '../theme.js';

interface TableProps {
  headers: string[];
  rows: string[][];
  width?: number;
}

export const Table: React.FC<TableProps> = ({headers, rows, width}) => {
  const colCount = headers.length;
  const maxWidth = width ? width - 4 : 80;

  // Calculate column widths based on content
  const colWidths = headers.map((h, i) => {
    let max = h.length;
    for (const row of rows) {
      const cell = row[i] ?? '';
      if (cell.length > max) max = cell.length;
    }
    return Math.min(max + 2, Math.floor(maxWidth / colCount));
  });

  const renderRow = (cells: string[], isHeader: boolean) => (
    <Box>
      <Text color={theme.ui.dim}>│</Text>
      {cells.map((cell, i) => {
        const w = colWidths[i] ?? 10;
        const padded = ` ${cell}`.padEnd(w, ' ').slice(0, w);
        return (
          <Fragment key={i}>
            <Text bold={isHeader} color={isHeader ? theme.text.accent : theme.text.primary}>
              {padded}
            </Text>
            <Text color={theme.ui.dim}>│</Text>
          </Fragment>
        );
      })}
    </Box>
  );

  const separator = (char: string) => {
    const line = colWidths.map((w) => char.repeat(w)).join('┼');
    return (
      <Text color={theme.ui.dim}>
        ├{line}┤
      </Text>
    );
  };

  const topBorder = colWidths.map((w) => '─'.repeat(w)).join('┬');
  const bottomBorder = colWidths.map((w) => '─'.repeat(w)).join('┴');

  return (
    <Box flexDirection="column">
      <Text color={theme.ui.dim}>┌{topBorder}┐</Text>
      {renderRow(headers, true)}
      {separator('─')}
      {rows.map((row, i) => (
        <Fragment key={i}>
          {renderRow(row, false)}
        </Fragment>
      ))}
      <Text color={theme.ui.dim}>└{bottomBorder}┘</Text>
    </Box>
  );
};
