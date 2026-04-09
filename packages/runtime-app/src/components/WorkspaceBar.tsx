/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import { useState } from 'react';
import type { WorkspaceState } from '../hooks/useWorkspace';

interface WorkspaceBarProps {
  workspace: WorkspaceState;
}

export function WorkspaceBar({ workspace }: WorkspaceBarProps) {
  const [persisting, setPersisting] = useState(false);
  const [discarding, setDiscarding] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const commitCount = workspace.stored?.commits?.length ?? 0;

  async function handlePersist() {
    setPersisting(true);
    setMessage(null);
    try {
      const result = await workspace.persist();
      setMessage(`Pushed to ${result.branch}`);
      setTimeout(() => setMessage(null), 5000);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Persist failed');
    }
    setPersisting(false);
  }

  async function handleDiscard() {
    if (!confirm('Discard all unpersisted changes?')) return;
    setDiscarding(true);
    setMessage(null);
    try {
      await workspace.discard();
    } catch {
      setMessage('Discard failed');
    }
    setDiscarding(false);
  }

  // Locked by another tab — show warning instead of actions
  if (workspace.lockedByOtherTab) {
    return (
      <div className="flex items-center gap-3 border-t border-border bg-card px-4 py-2 text-sm">
        <span className="inline-block h-2 w-2 rounded-full bg-red-500" />
        <span className="text-muted-foreground">
          Editing in another tab. Close that tab to edit here.
        </span>
      </div>
    );
  }

  return (
    <div className="flex flex-col border-t border-border bg-card text-sm">
      {/* Stale workspace warning */}
      {workspace.isStale && (
        <div className="flex items-center gap-2 bg-amber-500/10 px-4 py-1.5 text-xs text-amber-600 dark:text-amber-400">
          The agent has been redeployed since your edits began.
          <button
            onClick={() => void handleDiscard()}
            className="underline hover:no-underline"
          >
            Discard and reload
          </button>
        </div>
      )}

      {/* Bundle size warning */}
      {workspace.warning && (
        <div className="px-4 py-1 text-xs text-amber-600 dark:text-amber-400 bg-amber-500/10">
          {workspace.warning}
        </div>
      )}

      {/* Main bar */}
      <div className="flex items-center gap-3 px-4 py-2">
        <div className="flex items-center gap-2">
          <span className="inline-block h-2 w-2 rounded-full bg-amber-500" />
          <span className="text-muted-foreground">
            {commitCount} unsaved change{commitCount !== 1 ? 's' : ''}
          </span>
        </div>

        {workspace.persistedBranch && (
          <span className="text-muted-foreground text-xs">
            on <span className="font-mono text-foreground">{workspace.persistedBranch}</span>
          </span>
        )}

        <div className="ml-auto flex items-center gap-2">
          {message && (
            <span className="text-xs text-muted-foreground">{message}</span>
          )}

          <button
            onClick={() => void handleDiscard()}
            disabled={discarding}
            className="rounded px-3 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50"
          >
            {discarding ? 'Discarding...' : 'Discard'}
          </button>

          <button
            onClick={() => void handlePersist()}
            disabled={persisting || workspace.isStale}
            className="rounded bg-primary-solid px-3 py-1 text-xs text-white disabled:opacity-50"
          >
            {persisting ? 'Persisting...' : 'Persist'}
          </button>
        </div>
      </div>
    </div>
  );
}
