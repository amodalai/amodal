/**
 * @license
 * Copyright 2025 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import {useState, useEffect, useRef} from 'react';

/**
 * Returns elapsed seconds since mount or last reset.
 * Resets when `isStreaming` flips to true.
 */
export function useElapsedTime(isStreaming: boolean): number {
  const [elapsed, setElapsed] = useState(0);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const wasStreamingRef = useRef(false);

  useEffect(() => {
    // Reset when streaming starts
    if (isStreaming && !wasStreamingRef.current) {
      setElapsed(0);
    }
    wasStreamingRef.current = isStreaming;

    if (isStreaming) {
      intervalRef.current = setInterval(() => {
        setElapsed((prev) => prev + 1);
      }, 1000);
    } else if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [isStreaming]);

  return elapsed;
}
