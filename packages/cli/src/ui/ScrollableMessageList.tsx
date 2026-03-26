/**
 * @license
 * Copyright 2025 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import type React from 'react';
import {useMemo} from 'react';
import {Box, Text} from 'ink';
import {UserMessage} from './UserMessage.js';
import {AssistantMessage} from './AssistantMessage.js';
import {StreamingView} from './StreamingView.js';
import {theme} from './theme.js';
import type {ChatMessage, ToolCallInfo, ExplorePhase} from './types.js';

interface ScrollableMessageListProps {
  messages: ChatMessage[];
  width: number;
  viewportHeight: number;
  scrollTop: number;
  isStreaming: boolean;
  streamingText: string;
  thinkingText: string;
  toolCalls: ToolCallInfo[];
  skills: string[];
  explore: ExplorePhase | null;
  error: string | null;
}

/**
 * Renders messages and streaming content.
 * Scroll viewport is handled by the terminal's native scrollback for now.
 */
export const ScrollableMessageList: React.FC<ScrollableMessageListProps> = ({
  messages,
  width,
  isStreaming,
  streamingText,
  thinkingText,
  toolCalls,
  skills,
  explore,
  error,
}) => {
  const messageElements = useMemo(
    () =>
      messages.map((message) =>
        message.role === 'user' ? (
          <UserMessage key={message.id} text={message.text} />
        ) : (
          <AssistantMessage key={message.id} message={message} width={width} />
        ),
      ),
    [messages, width],
  );

  return (
    <Box flexDirection="column">
      {messageElements}

      {/* Live streaming content */}
      {isStreaming ? (
        <StreamingView
          text={streamingText}
          thinkingText={thinkingText}
          toolCalls={toolCalls}
          skills={skills}
          explore={explore}
          error={error}
          width={width}
        />
      ) : null}

      {/* Error display (non-streaming errors) */}
      {!isStreaming && error ? (
        <Box marginTop={1}>
          <Text color={theme.status.error}>[error] {error}</Text>
        </Box>
      ) : null}
    </Box>
  );
};
