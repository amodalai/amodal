/**
 * @license
 * Copyright 2025 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import type React from 'react';
import {Box, Text} from 'ink';
import {theme} from './theme.js';
import {ToolCallDisplay} from './ToolCallDisplay.js';
import {ThinkingDisplay} from './ThinkingDisplay.js';
import {ExploreIndicator} from './ExploreIndicator.js';
import type {ToolCallInfo, ExplorePhase} from './types.js';

interface StreamingViewProps {
  text: string;
  thinkingText?: string;
  toolCalls: ToolCallInfo[];
  skills: string[];
  explore?: ExplorePhase | null;
  error: string | null;
  width?: number;
}

export const StreamingView: React.FC<StreamingViewProps> = ({
  text,
  thinkingText,
  toolCalls,
  skills,
  explore,
  error,
  width,
}) => {
  if (
    !text &&
    !thinkingText &&
    toolCalls.length === 0 &&
    !error &&
    skills.length === 0 &&
    !explore
  ) {
    return null;
  }

  return (
    <Box flexDirection="column" marginTop={1}>
      {/* Activated skills */}
      {skills.map((skill, i) => (
        <Text key={i} color={theme.status.warning}>
          {'  \u26A1 '}
          {skill}
        </Text>
      ))}

      {/* Explore phase indicator */}
      {explore ? <ExploreIndicator phase={explore} /> : null}

      {/* Thinking display */}
      {thinkingText ? <ThinkingDisplay text={thinkingText} /> : null}

      {/* Streaming text (raw, no markdown rendering mid-stream) */}
      {text ? (
        <Box>
          <Text color={theme.text.accent}>{'\u2726 '}</Text>
          <Text wrap="wrap">{text}</Text>
        </Box>
      ) : null}

      {/* Active tool calls — running tools get full view, completed get compact */}
      {toolCalls.map((tool) => (
        <ToolCallDisplay
          key={tool.toolId}
          tool={tool}
          width={width}
          compact={tool.status !== 'running'}
        />
      ))}

      {/* Error */}
      {error ? (
        <Box marginTop={1}>
          <Text color={theme.status.error}>[error] {error}</Text>
        </Box>
      ) : null}
    </Box>
  );
};
