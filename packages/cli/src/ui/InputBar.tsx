/**
 * @license
 * Copyright 2025 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import type React from 'react';
import {useState, useCallback} from 'react';
import {Box, Text} from 'ink';
import TextInput from 'ink-text-input';
import Spinner from 'ink-spinner';
import {theme} from './theme.js';
import {parseSlashCommand} from './commands/index.js';

interface InputBarProps {
  onSubmit: (text: string) => void;
  onSlashCommand?: (name: string, args: string) => void;
  isStreaming: boolean;
  elapsed?: number;
  exploreQuery?: string;
  activeToolName?: string;
}

function formatElapsed(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}m${s}s`;
}

export const InputBar: React.FC<InputBarProps> = ({
  onSubmit,
  onSlashCommand,
  isStreaming,
  elapsed = 0,
  exploreQuery,
  activeToolName,
}) => {
  const [value, setValue] = useState('');

  const handleSubmit = useCallback(
    (text: string) => {
      const trimmed = text.trim();
      if (!trimmed) return;

      // Check for slash commands
      if (onSlashCommand) {
        const parsed = parseSlashCommand(trimmed);
        if (parsed) {
          onSlashCommand(parsed.name, parsed.args);
          setValue('');
          return;
        }
      }

      onSubmit(trimmed);
      setValue('');
    },
    [onSubmit, onSlashCommand],
  );

  if (isStreaming) {
    const elapsedStr = elapsed > 0 ? ` (${formatElapsed(elapsed)})` : '';

    let statusText: string;
    if (exploreQuery) {
      statusText = ` exploring "${exploreQuery}"${elapsedStr}`;
    } else if (activeToolName) {
      statusText = ` running ${activeToolName}${elapsedStr}`;
    } else {
      statusText = ` thinking${elapsedStr}`;
    }

    return (
      <Box marginTop={1}>
        <Text color={theme.text.accent}>
          <Spinner type="dots" />
        </Text>
        <Text color={theme.ui.dim}>{statusText}</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" marginTop={1}>
      <Box>
        <Text color={theme.border.default}>{'─'.repeat(process.stdout.columns || 80)}</Text>
      </Box>
      <Box>
        <Text color={theme.text.accent} bold>
          {'› '}
        </Text>
        <TextInput
          value={value}
          onChange={setValue}
          onSubmit={handleSubmit}
          placeholder="Type a message... (/help for commands)"
        />
      </Box>
      <Box>
        <Text color={theme.border.default}>{'─'.repeat(process.stdout.columns || 80)}</Text>
      </Box>
    </Box>
  );
};
