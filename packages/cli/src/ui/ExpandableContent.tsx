/**
 * @license
 * Copyright 2025 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import type React from 'react';
import {useState} from 'react';
import {Box, Text, useInput} from 'ink';
import {theme} from './theme.js';

interface ExpandableContentProps {
  title: string;
  content: string;
  defaultExpanded?: boolean;
  maxCollapsedLines?: number;
}

export const ExpandableContent: React.FC<ExpandableContentProps> = ({
  title,
  content,
  defaultExpanded = false,
  maxCollapsedLines = 5,
}) => {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const lines = content.split('\n');
  const shouldCollapse = lines.length > maxCollapsedLines;

  useInput((_input, key) => {
    if (key.return && shouldCollapse) {
      setExpanded((prev) => !prev);
    }
  });

  if (!shouldCollapse) {
    return (
      <Text color={theme.text.secondary} wrap="truncate-end">
        {content}
      </Text>
    );
  }

  if (!expanded) {
    return (
      <Box>
        <Text color={theme.ui.dim}>
          {'\u25B8 '}
          {title} ({lines.length} lines)
        </Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column">
      <Text color={theme.ui.dim}>
        {'\u25BE '}
        {title}
      </Text>
      {lines.map((line, i) => (
        <Box key={i}>
          <Text color={theme.text.accent}>{'\u2502 '}</Text>
          <Text color={theme.text.secondary}>{line}</Text>
        </Box>
      ))}
    </Box>
  );
};
