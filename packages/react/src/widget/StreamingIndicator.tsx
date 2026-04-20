/**
 * @license
 * Copyright 2025 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import { useEffect, useState } from 'react';

interface StreamingIndicatorProps {
  /** Timestamp (Date.now()) when streaming started. If provided, shows elapsed seconds. */
  startTime?: number;
}

export function StreamingIndicator({ startTime }: StreamingIndicatorProps) {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    if (!startTime) return;
    const interval = setInterval(() => setElapsed(Math.floor((Date.now() - startTime) / 1000)), 1000);
    return () => clearInterval(interval);
  }, [startTime]);

  return (
    <div className="pcw-streaming" aria-label="Streaming">
      <span className="pcw-streaming__dot" />
      <span className="pcw-streaming__dot" />
      <span className="pcw-streaming__dot" />
      {startTime && elapsed >= 1 && (
        <span className="pcw-streaming__elapsed">{elapsed}s</span>
      )}
    </div>
  );
}
