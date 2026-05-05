/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

/**
 * Confirm + warning modals for the "Finish setup" button. Phase E.6 of
 * the admin-setup build plan.
 *
 * Two modal shapes:
 *
 * - `<ConfirmCompletionModal>` — readiness check passed. Shows a
 *   short "Finish setup? Your agent will start running. You can edit
 *   files anytime after." + Finish / Cancel.
 *
 * - `<CompletionWarningsModal>` — readiness check returned warnings.
 *   Lists each warning's user-visible message and offers "Go back to
 *   chat" (default) / "Finish anyway" (force commit). The framing is
 *   one-way: once committed, the user exits setup mode.
 */

import type { SetupWarning } from '@amodalai/types';
import { AlertTriangle, X } from 'lucide-react';

interface ConfirmCompletionModalProps {
  open: boolean;
  busy: boolean;
  error: string | null;
  onCancel: () => void;
  onConfirm: () => void;
}

export function ConfirmCompletionModal({
  open,
  busy,
  error,
  onCancel,
  onConfirm,
}: ConfirmCompletionModalProps) {
  if (!open) return null;
  return (
    <ModalShell onClose={onCancel} title="Finish setup?">
      <p className="text-[13px] text-foreground leading-relaxed mb-4">
        Your agent will start running. You can edit files anytime after.
      </p>
      {error && <ModalError message={error} />}
      <div className="flex justify-end gap-2 mt-2">
        <button
          type="button"
          onClick={onCancel}
          disabled={busy}
          className="px-3 py-1.5 rounded-md text-[12px] border border-border text-foreground hover:bg-muted/40 disabled:opacity-50"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={onConfirm}
          disabled={busy}
          className="px-3 py-1.5 rounded-md text-[12px] bg-primary-solid text-white hover:opacity-90 disabled:opacity-50"
        >
          {busy ? 'Finishing…' : 'Finish setup'}
        </button>
      </div>
    </ModalShell>
  );
}

interface CompletionWarningsModalProps {
  open: boolean;
  busy: boolean;
  warnings: SetupWarning[];
  error: string | null;
  onBackToChat: () => void;
  onFinishAnyway: () => void;
}

export function CompletionWarningsModal({
  open,
  busy,
  warnings,
  error,
  onBackToChat,
  onFinishAnyway,
}: CompletionWarningsModalProps) {
  if (!open) return null;
  return (
    <ModalShell onClose={onBackToChat} title="Setup isn't quite done">
      <div className="text-[13px] text-foreground leading-relaxed mb-3">
        We noticed:
      </div>
      <ul className="space-y-2 mb-4">
        {warnings.map((warning, i) => (
          <li
            key={`${warning.kind}-${warning.target}-${String(i)}`}
            className="flex items-start gap-2 text-[12.5px]"
          >
            <AlertTriangle
              className={`shrink-0 mt-0.5 h-3.5 w-3.5 ${warning.severity === 'block' ? 'text-amber-600 dark:text-amber-500' : 'text-muted-foreground'}`}
            />
            <span className="text-foreground">{warning.message}</span>
          </li>
        ))}
      </ul>
      <p className="text-[11.5px] text-muted-foreground italic mb-4">
        Finishing now is one-way &mdash; once your agent&apos;s config is
        committed, you&apos;ll exit setup mode.
      </p>
      {error && <ModalError message={error} />}
      <div className="flex justify-end gap-2 mt-2">
        <button
          type="button"
          onClick={onBackToChat}
          disabled={busy}
          className="px-3 py-1.5 rounded-md text-[12px] border border-border text-foreground hover:bg-muted/40 disabled:opacity-50"
        >
          Go back to chat
        </button>
        <button
          type="button"
          onClick={onFinishAnyway}
          disabled={busy}
          className="px-3 py-1.5 rounded-md text-[12px] bg-amber-600 text-white hover:bg-amber-700 disabled:opacity-50"
        >
          {busy ? 'Finishing…' : 'Finish anyway'}
        </button>
      </div>
    </ModalShell>
  );
}

// ---------------------------------------------------------------------------
// Shared shell
// ---------------------------------------------------------------------------

function ModalShell({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-md rounded-lg border border-border bg-card shadow-xl p-5">
        <div className="flex items-start justify-between mb-3">
          <h2 className="text-[14px] font-semibold text-foreground tracking-tight">
            {title}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="p-1 -m-1 text-muted-foreground hover:text-foreground rounded-sm"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function ModalError({ message }: { message: string }) {
  return (
    <p className="mb-2 text-[12px] text-red-700 dark:text-red-400 bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900/60 rounded-md px-3 py-2">
      {message}
    </p>
  );
}
