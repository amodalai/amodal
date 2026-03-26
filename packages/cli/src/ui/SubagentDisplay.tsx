/**
 * @license
 * Copyright 2025 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import type React from 'react';
import {Box, Text} from 'ink';
import {theme} from './theme.js';
import type {SubagentEventInfo} from './types.js';

interface SubagentDisplayProps {
  events: SubagentEventInfo[];
}

export const SubagentDisplay: React.FC<SubagentDisplayProps> = ({events}) => {
  if (events.length === 0) return null;

  return (
    <Box flexDirection="column" paddingLeft={2}>
      {events.map((event, i) => {
        const isLast = i === events.length - 1;
        const prefix = isLast ? '└─' : '├─';

        if (event.error) {
          return (
            <Text key={i} color={theme.status.error}>
              {prefix} {event.agentName}: {event.error}
            </Text>
          );
        }

        if (event.text) {
          return (
            <Text key={i} color={theme.text.secondary}>
              {prefix} {event.agentName}: {event.text}
            </Text>
          );
        }

        if (event.toolName) {
          return (
            <Text key={i} color={theme.ui.dim}>
              {prefix} {event.agentName} › {event.toolName}
            </Text>
          );
        }

        return (
          <Text key={i} color={theme.ui.dim}>
            {prefix} {event.agentName} [{event.eventType}]
          </Text>
        );
      })}
    </Box>
  );
};
