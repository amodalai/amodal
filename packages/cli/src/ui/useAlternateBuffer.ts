/**
 * @license
 * Copyright 2025 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import {useEffect} from 'react';

/**
 * Enters the terminal's alternate screen buffer on mount,
 * exits back to normal buffer on unmount.
 */
export function useAlternateBuffer(enabled: boolean): void {
  useEffect(() => {
    if (!enabled) return;

    // Enter alternate buffer
    process.stdout.write('\x1b[?1049h');
    // Move cursor to top-left
    process.stdout.write('\x1b[H');

    return () => {
      // Exit alternate buffer
      process.stdout.write('\x1b[?1049l');
    };
  }, [enabled]);
}
