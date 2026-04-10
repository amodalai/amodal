/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

/**
 * Deploy confirmation modal — shown when the user clicks Persist/Deploy
 * in the WorkspaceBar. Lists the files about to be deployed and asks for
 * confirmation before pushing.
 *
 * Future: when the cloud workspace exposes a diff endpoint
 * (`/api/workspace/diff` returning `{path, before, after}[]`), we will
 * fetch from it on open and render <DiffView> per file. For now this
 * just lists changed file paths so users can sanity-check before
 * triggering a deploy.
 */

import { useEffect } from 'react';

export interface DeployConfirmModalProps {
  /** Files that will be deployed (deduplicated across all pending commits). */
  files: string[];
  /** Called when the user confirms. */
  onConfirm: () => void;
  /** Called when the user cancels or closes the modal. */
  onCancel: () => void;
  /** Whether a deploy is currently in flight (disables the confirm button). */
  busy?: boolean;
}

export function DeployConfirmModal({ files, onConfirm, onCancel, busy }: DeployConfirmModalProps) {
  // Close on Escape for keyboard accessibility.
  useEffect(() => {
    const handleKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape' && !busy) onCancel();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [busy, onCancel]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={busy ? undefined : onCancel}
      role="dialog"
      aria-modal="true"
      aria-labelledby="deploy-confirm-title"
    >
      <div
        className="w-full max-w-lg overflow-hidden rounded-xl border border-border bg-card shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="border-b border-border px-5 py-4">
          <h3 id="deploy-confirm-title" className="text-sm font-semibold text-foreground">
            Deploy changes?
          </h3>
          <p className="mt-1 text-xs text-muted-foreground">
            {files.length} file{files.length === 1 ? '' : 's'} will be deployed.
          </p>
        </div>

        <div className="max-h-[50vh] overflow-y-auto px-5 py-4">
          {files.length === 0 ? (
            <div className="text-xs text-muted-foreground italic">No changes</div>
          ) : (
            <ul className="space-y-1.5">
              {files.map((path) => (
                <li
                  key={path}
                  className="rounded-md bg-muted px-2.5 py-1.5 font-mono text-xs text-foreground"
                >
                  {path}
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-border bg-muted/30 px-5 py-3">
          <button
            onClick={onCancel}
            disabled={busy}
            className="rounded-md px-3 py-1.5 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground transition-colors disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={busy || files.length === 0}
            className="rounded-md bg-primary-solid px-3 py-1.5 text-xs font-medium text-white transition-colors disabled:opacity-50"
          >
            {busy ? 'Deploying...' : 'Deploy'}
          </button>
        </div>
      </div>
    </div>
  );
}
