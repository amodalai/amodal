/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

'use client';

/**
 * PublishDialog — modal for committing staged drafts to the agent's git repo.
 *
 * Renders a commit message textarea, a read-only file list, and Commit/Cancel
 * buttons. On failure the dialog stays open with an inline error.
 */

import { useEffect, useRef, useState } from 'react';
import type { DraftFile, PublishResult } from '@/lib/types';

export interface PublishDialogProps {
  /** The drafts that will be committed. */
  drafts: DraftFile[];
  /** Invoked on confirm. Returns null on failure. */
  onConfirm: (commitMessage: string) => Promise<PublishResult | null>;
  /** Invoked when the user cancels. */
  onCancel: () => void;
}

export function PublishDialog({ drafts, onConfirm, onCancel }: PublishDialogProps) {
  const [commitMessage, setCommitMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  useEffect(() => {
    const handleKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape' && !busy) onCancel();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [busy, onCancel]);

  const trimmed = commitMessage.trim();
  const canCommit = trimmed.length > 0 && !busy && drafts.length > 0;

  async function handleConfirm(): Promise<void> {
    if (!canCommit) return;
    setBusy(true);
    setError(null);
    try {
      const result = await onConfirm(trimmed);
      if (!result) {
        setError('Publish failed. See the draft bar for details.');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Publish failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={busy ? undefined : onCancel}
      role="dialog"
      aria-modal="true"
      aria-labelledby="publish-dialog-title"
    >
      <div
        className="w-full max-w-lg overflow-hidden rounded-xl border border-border bg-card shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="border-b border-border px-5 py-4">
          <h3 id="publish-dialog-title" className="text-sm font-semibold text-foreground">
            Publish changes
          </h3>
          <p className="mt-1 text-xs text-muted-foreground">
            Commit {drafts.length} file{drafts.length === 1 ? '' : 's'} to the agent repo.
          </p>
        </div>

        <div className="px-5 py-4 space-y-3">
          <label className="block">
            <span className="text-xs font-medium text-foreground">Commit message</span>
            <textarea
              ref={textareaRef}
              value={commitMessage}
              onChange={(e) => setCommitMessage(e.target.value)}
              disabled={busy}
              rows={3}
              placeholder="Update pricing skill"
              className="mt-1 w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-50"
            />
          </label>

          <div>
            <span className="text-xs font-medium text-foreground">Files</span>
            <div className="mt-1 max-h-[30vh] overflow-y-auto rounded-md border border-border bg-muted/30">
              {drafts.length === 0 ? (
                <div className="px-2.5 py-1.5 text-xs italic text-muted-foreground">
                  No changes
                </div>
              ) : (
                <ul className="p-1.5 space-y-1">
                  {drafts.map((draft) => (
                    <li
                      key={draft.filePath}
                      className="rounded bg-card px-2 py-1 font-mono text-[11px] text-foreground"
                    >
                      {draft.filePath}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>

        {error && (
          <div className="border-t border-border bg-red-500/10 px-5 py-2 text-xs text-red-600 dark:text-red-400">
            {error}
          </div>
        )}

        <div className="flex items-center justify-end gap-2 border-t border-border bg-muted/30 px-5 py-3">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="rounded-md px-3 py-1.5 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground transition-colors disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void handleConfirm()}
            disabled={!canCommit}
            className="rounded-md bg-primary-solid px-3 py-1.5 text-xs font-medium text-white transition-colors disabled:opacity-50"
          >
            {busy ? 'Publishing...' : 'Commit'}
          </button>
        </div>
      </div>
    </div>
  );
}
