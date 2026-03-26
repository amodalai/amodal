/**
 * @license
 * Copyright 2025 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import type React from 'react';
import {Box, Text, useInput} from 'ink';
import {theme} from './theme.js';
import type {ConfirmationRequest} from './types.js';

interface ConfirmationPromptProps {
  request: ConfirmationRequest;
  queueSize?: number;
  onRespond: (approved: boolean) => void;
  onApproveAll?: () => void;
  onRejectAll?: () => void;
}

export const ConfirmationPrompt: React.FC<ConfirmationPromptProps> = ({
  request,
  queueSize = 1,
  onRespond,
  onApproveAll,
  onRejectAll,
}) => {
  useInput((input) => {
    if (input === 'y' || input === 'Y') {
      onRespond(true);
    } else if (input === 'n' || input === 'N') {
      onRespond(false);
    } else if ((input === 'a' || input === 'A') && onApproveAll && queueSize > 1) {
      onApproveAll();
    } else if ((input === 'r' || input === 'R') && onRejectAll && queueSize > 1) {
      onRejectAll();
    }
  });

  return (
    <Box
      flexDirection="column"
      marginTop={1}
      borderStyle="round"
      borderColor={theme.status.warning}
      paddingLeft={1}
      paddingRight={1}
    >
      <Box>
        <Text color={theme.status.warning} bold>
          Confirmation Required
        </Text>
        {queueSize > 1 ? (
          <Text color={theme.ui.dim}> (1 of {queueSize})</Text>
        ) : null}
      </Box>
      <Text bold>
        {request.method} {request.endpoint}
      </Text>
      <Text wrap="wrap">{request.reason}</Text>
      {request.escalated ? (
        <Text color={theme.status.warning}>{'\u26A0'} Escalated — requires explicit approval</Text>
      ) : null}
      <Box marginTop={1} gap={2}>
        <Text color={theme.status.success}>[y] Approve</Text>
        <Text color={theme.status.error}>[n] Reject</Text>
        {queueSize > 1 ? (
          <>
            <Text color={theme.status.success}>[a] Approve all</Text>
            <Text color={theme.status.error}>[r] Reject all</Text>
          </>
        ) : null}
      </Box>
    </Box>
  );
};
