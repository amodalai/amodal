/**
 * @license
 * Copyright 2025 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import type React from 'react';
import {Box, Text} from 'ink';
import Spinner from 'ink-spinner';
import {theme} from './theme.js';
import type {ExplorePhase} from './types.js';

interface ExploreIndicatorProps {
  phase: ExplorePhase;
}

export const ExploreIndicator: React.FC<ExploreIndicatorProps> = ({phase}) => {
  if (phase.active) {
    return (
      <Box>
        <Text color={theme.text.link}>
          <Spinner type="dots" />
          {' \uD83D\uDD0D Exploring: '}
        </Text>
        <Text color={theme.text.secondary}>&quot;{phase.query}&quot;</Text>
      </Box>
    );
  }

  const tokenStr = phase.tokensUsed
    ? ` (${(phase.tokensUsed / 1000).toFixed(1)}K tokens)`
    : '';

  return (
    <Box>
      <Text color={theme.ui.dim}>
        {'\uD83D\uDD0D Explored: "'}
        {phase.query}
        {'"'}
        {tokenStr}
      </Text>
    </Box>
  );
};
