/**
 * @license
 * Copyright 2025 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import type React from 'react';
import {Box, Text} from 'ink';
import Spinner from 'ink-spinner';
import {theme} from './theme.js';

// ASCII art banner — compact 3-line logo
const BANNER = [
  '  ▄▀█ █▀▄▀█ █▀█ █▀▄ ▄▀█ █░░',
  '  █▀█ █░▀░█ █▄█ █▄▀ █▀█ █▄▄',
];

interface HeaderProps {
  sessionId: string | null;
  isStreaming: boolean;
  isNarrow?: boolean;
}

export const Header: React.FC<HeaderProps> = ({sessionId, isStreaming, isNarrow}) => (
  <Box flexDirection="column" marginBottom={1}>
    {!isNarrow ? (
      <Box flexDirection="column">
        {BANNER.map((line, i) => (
          <Text key={i} color={theme.text.accent} bold>{line}</Text>
        ))}
      </Box>
    ) : null}
    <Box>
      {isNarrow ? (
        <Text color={theme.text.accent} bold>am</Text>
      ) : null}
      {sessionId ? (
        <Text color={theme.ui.dim}>  {'\u25C6'} {isNarrow ? sessionId.slice(0, 4) : `session ${sessionId.slice(0, 8)}`}</Text>
      ) : null}
      <Text color={theme.ui.dim}> {'\u25C6'} </Text>
      {isStreaming ? (
        <Text color={theme.status.warning}>
          <Spinner type="dots" /> streaming
        </Text>
      ) : (
        <Text color={theme.ui.dim}>ready</Text>
      )}
    </Box>
  </Box>
);
