/**
 * @license
 * Copyright 2025 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import type React from 'react';
import {Box, Text} from 'ink';
import {theme} from './theme.js';

interface StatusMessageProps {
  type: 'info' | 'warning' | 'error' | 'success';
  children: React.ReactNode;
}

const icons: Record<StatusMessageProps['type'], string> = {
  info: '\u2139',
  warning: '\u26A0',
  error: '\u2717',
  success: '\u2713',
};

const colors: Record<StatusMessageProps['type'], string> = {
  info: theme.text.link,
  warning: theme.status.warning,
  error: theme.status.error,
  success: theme.status.success,
};

export const StatusMessage: React.FC<StatusMessageProps> = ({type, children}) => (
  <Box>
    <Text color={colors[type]}>{icons[type]} </Text>
    <Text color={colors[type]}>{children}</Text>
  </Box>
);
