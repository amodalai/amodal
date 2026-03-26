/**
 * @license
 * Copyright 2025 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import type React from 'react';
import {Box, Text} from 'ink';
import {theme} from './theme.js';

interface ThinkingDisplayProps {
  text: string;
  collapsed?: boolean;
}

export const ThinkingDisplay: React.FC<ThinkingDisplayProps> = ({text, collapsed}) => {
  if (!text) return null;

  if (collapsed) {
    const firstLine = text.split('\n')[0] ?? '';
    const summary = firstLine.length > 60 ? firstLine.slice(0, 60) + '...' : firstLine;
    return (
      <Box marginLeft={2}>
        <Text color={theme.ui.dim} dimColor>
          {'  \uD83D\uDCAD '}
          {summary}
        </Text>
      </Box>
    );
  }

  const lines = text.split('\n');
  return (
    <Box flexDirection="column" marginLeft={2}>
      {lines.map((line, i) => (
        <Box key={i}>
          <Text color={theme.text.accent}>{i === 0 ? '  \uD83D\uDCAD ' : '  \u2502 '}</Text>
          <Text color={theme.ui.dim} dimColor>
            {line}
          </Text>
        </Box>
      ))}
    </Box>
  );
};
