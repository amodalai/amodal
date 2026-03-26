/**
 * @license
 * Copyright 2025 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import type React from 'react';
import {Box, Text} from 'ink';
import {theme} from './theme.js';
import {MarkdownDisplay} from './markdown/MarkdownDisplay.js';
import {ToolCallDisplay} from './ToolCallDisplay.js';
import {ThinkingDisplay} from './ThinkingDisplay.js';
import type {ChatMessage} from './types.js';

interface AssistantMessageProps {
  message: ChatMessage;
  width?: number;
}

export const AssistantMessage: React.FC<AssistantMessageProps> = ({
  message,
  width,
}) => (
  <Box flexDirection="column" marginTop={1}>
    {/* Skills activated */}
    {message.skills?.map((skill, i) => (
      <Text key={i} color={theme.status.warning}>
        {'  \u26A1 '}
        {skill}
      </Text>
    ))}

    {/* Collapsed thinking */}
    {message.thinking ? <ThinkingDisplay text={message.thinking} collapsed /> : null}

    {/* Tool calls — inline before text (matches actual execution order) */}
    {message.toolCalls?.map((tool) => (
      <ToolCallDisplay key={tool.toolId} tool={tool} width={width} compact />
    ))}

    {/* Main text with markdown */}
    {message.text ? (
      <Box>
        <Text color={theme.text.accent}>{'\u25C6 '}</Text>
        <Box flexDirection="column" width={width ? width - 4 : undefined}>
          <MarkdownDisplay text={message.text} width={width ? width - 4 : undefined} />
        </Box>
      </Box>
    ) : null}
  </Box>
);
