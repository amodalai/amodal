/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import { useCallback, useState } from 'react';
import { Play, Square, RotateCw } from 'lucide-react';

// ---------------------------------------------------------------------------
// Route constants
// ---------------------------------------------------------------------------

const AUTOMATIONS_API_BASE = '/api/studio/automations';

function automationRunUrl(name: string): string {
  return `${AUTOMATIONS_API_BASE}/${encodeURIComponent(name)}/run`;
}

function automationStartUrl(name: string): string {
  return `${AUTOMATIONS_API_BASE}/${encodeURIComponent(name)}/start`;
}

function automationStopUrl(name: string): string {
  return `${AUTOMATIONS_API_BASE}/${encodeURIComponent(name)}/stop`;
}

// ---------------------------------------------------------------------------
// Run Now button
// ---------------------------------------------------------------------------

export function RunNowButton({ name, onComplete }: { name: string; onComplete?: () => void }) {
  const [pending, setPending] = useState(false);

  const handleClick = useCallback(async () => {
    setPending(true);
    try {
      await fetch(automationRunUrl(name), {
        method: 'POST',
        signal: AbortSignal.timeout(10_000),
      });
      onComplete?.();
    } finally {
      setPending(false);
    }
  }, [name, onComplete]);

  return (
    <button
      onClick={() => void handleClick()}
      disabled={pending}
      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm rounded bg-primary/10 text-primary hover:bg-primary/20 disabled:opacity-50 transition-colors"
    >
      {pending ? (
        <RotateCw className="w-3.5 h-3.5 animate-spin" />
      ) : (
        <Play className="w-3.5 h-3.5" />
      )}
      Run Now
    </button>
  );
}

// ---------------------------------------------------------------------------
// Start / Stop toggle
// ---------------------------------------------------------------------------

export function ToggleButton({
  name,
  enabled,
  onComplete,
}: {
  name: string;
  enabled: boolean;
  onComplete?: () => void;
}) {
  const [isPending, setIsPending] = useState(false);

  const handleToggle = useCallback(() => {
    const url = enabled ? automationStopUrl(name) : automationStartUrl(name);
    setIsPending(true);
    void fetch(url, {
      method: 'POST',
      signal: AbortSignal.timeout(10_000),
    })
      .then(() => {
        onComplete?.();
      })
      .finally(() => {
        setIsPending(false);
      });
  }, [name, enabled, onComplete]);

  if (enabled) {
    return (
      <button
        onClick={handleToggle}
        disabled={isPending}
        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm rounded bg-red-500/10 text-red-500 hover:bg-red-500/20 disabled:opacity-50 transition-colors"
      >
        <Square className="w-3.5 h-3.5" />
        {isPending ? 'Stopping...' : 'Stop'}
      </button>
    );
  }

  return (
    <button
      onClick={handleToggle}
      disabled={isPending}
      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm rounded bg-emerald-500/10 text-emerald-500 hover:bg-emerald-500/20 disabled:opacity-50 transition-colors"
    >
      <Play className="w-3.5 h-3.5" />
      {isPending ? 'Starting...' : 'Start'}
    </button>
  );
}
