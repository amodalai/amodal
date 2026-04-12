/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

'use client';

import { useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
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
 * Triggers a router refresh on completion to update the run history.
 */
export function AutomationLiveStatus({ name }: { name: string }) {
  const [running, setRunning] = useState(false);
  const router = useRouter();

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
          router.refresh();
        }
      },
      [name, router],
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
