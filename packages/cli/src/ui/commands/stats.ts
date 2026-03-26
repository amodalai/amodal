/**
 * @license
 * Copyright 2025 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import {registerCommand} from './registry.js';
import type {CommandResult} from './registry.js';
import type {ChatState} from '../types.js';

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

registerCommand({
  name: 'stats',
  description: 'Show session statistics',
  aliases: ['s'],
  execute: (_args: string, state: ChatState): CommandResult => {
    const {tokenUsage} = state;
    const lines = [
      'Session Statistics:',
      `  Session:    ${state.sessionId ?? 'none'}`,
      `  Messages:   ${state.messages.length}`,
      `  Turns:      ${tokenUsage.turnCount}`,
      `  Model:      ${tokenUsage.model ?? 'unknown'}`,
      `  Input:      ${formatTokens(tokenUsage.totalInputTokens)} tokens`,
      `  Output:     ${formatTokens(tokenUsage.totalOutputTokens)} tokens`,
      `  Total:      ${formatTokens(tokenUsage.totalTokens)} tokens`,
    ];
    return {type: 'message', text: lines.join('\n')};
  },
});
