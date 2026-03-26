/**
 * @license
 * Copyright 2025 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import type React from 'react';
import {Box, Text} from 'ink';
import {theme} from './theme.js';
import type {TokenUsageInfo} from './types.js';

interface FooterProps {
  isStreaming: boolean;
  hasPendingQuestion: boolean;
  hasPendingConfirmation?: boolean;
  tokenUsage?: TokenUsageInfo;
  cwd?: string;
  modelName?: string;
  isNarrow?: boolean;
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function shortenCwd(cwd: string): string {
  const home = process.env['HOME'] ?? '';
  if (home && cwd.startsWith(home)) {
    return '~' + cwd.slice(home.length);
  }
  // If too long, show last 2 segments
  const parts = cwd.split('/');
  if (parts.length > 3) {
    return '~/...' + '/' + parts.slice(-2).join('/');
  }
  return cwd;
}

export const Footer: React.FC<FooterProps> = ({
  isStreaming,
  hasPendingQuestion,
  hasPendingConfirmation,
  tokenUsage,
  cwd,
  modelName,
  isNarrow,
}) => {
  // Line 1: shortcuts
  let hints: string;
  if (hasPendingConfirmation) {
    hints = '[y] approve  [n] reject  Ctrl+C exit';
  } else if (hasPendingQuestion) {
    hints = 'Enter answer  \u00B7  Ctrl+C exit';
  } else if (isStreaming) {
    hints = 'waiting...  \u00B7  Ctrl+C exit';
  } else if (isNarrow) {
    hints = 'Enter send  \u00B7  Ctrl+C exit';
  } else {
    hints = 'Enter send  \u00B7  j/k scroll  \u00B7  Ctrl+E expand tool  \u00B7  /help  \u00B7  Ctrl+C exit';
  }

  // Line 2: model + tokens + cwd
  const infoParts: string[] = [];
  if (modelName || tokenUsage?.model) {
    const model = modelName ?? tokenUsage?.model ?? '';
    // Shorten model name (e.g., "claude-sonnet-4-20250514" → "claude-sonnet-4")
    const shortModel = model.replace(/-\d{8}$/, '');
    infoParts.push(shortModel);
  }
  if (tokenUsage && tokenUsage.totalTokens > 0) {
    infoParts.push(`${formatTokens(tokenUsage.totalTokens)} tokens`);
  }
  if (cwd && !isNarrow) {
    infoParts.push(shortenCwd(cwd));
  }

  return (
    <Box flexDirection="column" marginTop={1}>
      <Text color={theme.ui.dim}>{hints}</Text>
      {infoParts.length > 0 ? (
        <Text color={theme.ui.muted}>{infoParts.join(' | ')}</Text>
      ) : null}
    </Box>
  );
};
