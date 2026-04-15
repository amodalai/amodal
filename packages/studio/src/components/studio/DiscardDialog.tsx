/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

/**
 * DiscardDialog — confirmation modal for "discard all unpublished changes."
 *
 * The "discard" button is styled with red-500/600 (raw Tailwind) per the
 * engineering standards: semantic status colors like destructive-red are
 * allowed as raw colors. Structural surfaces and borders still use the
 * design tokens (`bg-card`, `border-border`, etc.).
 */

import { useEffect, useState } from 'react';

export interface DiscardDialogProps {
  /** Number of drafts about to be discarded. */
  count: number;
  /** Invoked when the user confirms; should throw on failure. */
  onConfirm: () => Promise<void>;
  /** Invoked when the user cancels the dialog. */
  onCancel: () => void;
}

export function DiscardDialog({ count, onConfirm, onCancel }: DiscardDialogProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const handleKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape' && !busy) onCancel();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [busy, onCancel]);

  async function handleConfirm(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      await onConfirm();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Discard failed');
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
      aria-labelledby="discard-dialog-title"
    >
      <div
        className="w-full max-w-md overflow-hidden rounded-xl border border-border bg-card shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="border-b border-border px-5 py-4">
          <h3 id="discard-dialog-title" className="text-sm font-semibold text-foreground">
            Discard unpublished changes?
          </h3>
          <p className="mt-1 text-xs text-muted-foreground">
            Discard all {count} unpublished change{count === 1 ? '' : 's'}? This cannot be undone.
          </p>
        </div>

        {error && (
          <div className="border-b border-border bg-red-500/10 px-5 py-2 text-xs text-red-600 dark:text-red-400">
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
            disabled={busy || count === 0}
            className="rounded-md bg-red-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-500 transition-colors disabled:opacity-50"
          >
            {busy ? 'Discarding...' : 'Discard'}
          </button>
        </div>
      </div>
    </div>
  );
}
