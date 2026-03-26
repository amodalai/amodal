/**
 * @license
 * Copyright 2025 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import type React from 'react';
import {Box, useStdout} from 'ink';
import {useAlternateBuffer} from './useAlternateBuffer.js';

interface FullScreenLayoutProps {
  header: React.ReactNode;
  footer: React.ReactNode;
  children: React.ReactNode;
}

/**
 * Full-screen layout using alternate buffer.
 * Header pinned to top, footer pinned to bottom, children fill the middle.
 */
export const FullScreenLayout: React.FC<FullScreenLayoutProps> = ({
  header,
  footer,
  children,
}) => {
  const {stdout} = useStdout();
  const rows = stdout?.rows ?? 24;

  useAlternateBuffer(true);

  return (
    <Box flexDirection="column" height={rows}>
      {/* Pinned header */}
      {header}

      {/* Scrollable middle */}
      <Box flexDirection="column" flexGrow={1}>
        {children}
      </Box>

      {/* Pinned footer */}
      {footer}
    </Box>
  );
};
