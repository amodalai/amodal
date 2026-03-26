/**
 * @license
 * Copyright 2025 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import type React from 'react';
import {useEffect} from 'react';
import {Box, Text} from 'ink';
import {theme} from './theme.js';
import type {NotificationInfo} from './types.js';

interface NotificationBarProps {
  notifications: NotificationInfo[];
  onDismiss: (id: string) => void;
}

const notificationIcons: Record<NotificationInfo['type'], string> = {
  credential_saved: '\uD83D\uDD11',
  approved: '\u2713',
  kb_proposal: '\uD83D\uDCCB',
  field_scrub: '\uD83D\uDEE1\uFE0F',
  info: '\u2139',
  warning: '\u26A0',
};

const notificationColors: Record<NotificationInfo['type'], string> = {
  credential_saved: theme.status.success,
  approved: theme.status.success,
  kb_proposal: theme.text.link,
  field_scrub: theme.status.warning,
  info: theme.text.link,
  warning: theme.status.warning,
};

export const NotificationBar: React.FC<NotificationBarProps> = ({notifications, onDismiss}) => {
  useEffect(() => {
    if (notifications.length === 0) return;
    const timers = notifications.map((n) =>
      setTimeout(() => {
        onDismiss(n.id);
      }, 5000),
    );
    return () => {
      timers.forEach((t) => {
        clearTimeout(t);
      });
    };
  }, [notifications, onDismiss]);

  if (notifications.length === 0) return null;

  return (
    <Box flexDirection="column">
      {notifications.map((n) => (
        <Box key={n.id}>
          <Text color={notificationColors[n.type]}>
            {notificationIcons[n.type]} {n.message}
          </Text>
        </Box>
      ))}
    </Box>
  );
};
