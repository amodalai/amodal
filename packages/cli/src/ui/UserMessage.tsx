/**
 * @license
 * Copyright 2025 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import type React from 'react';
import {Box, Text} from 'ink';
import {theme} from './theme.js';

interface UserMessageProps {
  text: string;
}

export const UserMessage: React.FC<UserMessageProps> = ({text}) => (
  <Box marginTop={1}>
    <Text color={theme.text.accent} bold>
      {'› '}
    </Text>
    <Text>{text}</Text>
  </Box>
);
