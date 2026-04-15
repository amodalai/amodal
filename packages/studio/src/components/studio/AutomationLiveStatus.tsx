/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import { useState, useCallback } from 'react';
import { useStudioEvents } from '@/contexts/StudioEventsContext';
import { RotateCw } from 'lucide-react';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isObjectWithName(value: unknown): value is { name: unknown; status?: unknown } {
  return typeof value === 'object' && value !== null && 'name' in value;
}

// ---------------------------------------------------------------------------
// Live status indicator
// ---------------------------------------------------------------------------

/**
 * Subscribes to SSE events for automation_started / automation_completed
 * and shows a "Running..." indicator when the named automation is active.
 * Calls onComplete when the automation finishes to allow the parent to refetch.
 */
export function AutomationLiveStatus({
  name,
  onComplete,
}: {
  name: string;
  onComplete?: () => void;
}) {
  const [running, setRunning] = useState(false);

  useStudioEvents(
    ['automation_started', 'automation_completed'],
    useCallback(
      (payload: unknown) => {
        if (!isObjectWithName(payload)) return;
        if (payload.name !== name) return;

        if (!('status' in payload)) {
          // automation_started event (no status field)
          setRunning(true);
        } else {
          // automation_completed event
          setRunning(false);
          onComplete?.();
        }
      },
      [name, onComplete],
    ),
  );

  if (!running) return null;

  return (
    <span className="inline-flex items-center gap-1.5 px-2 py-0.5 text-xs rounded-full bg-amber-500/10 text-amber-500">
      <RotateCw className="w-3 h-3 animate-spin" />
      Running...
    </span>
  );
}
