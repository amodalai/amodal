/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

/**
 * DraftWorkspaceBar — pinned bar at the bottom of the files editor showing
 * the draft count and Discard / Preview / Publish actions.
 *
 * This is the new (PR 2.6) replacement for the older `WorkspaceBar` which
 * spoke to the legacy client-side git bundle workspace. Everything here
 * goes through `useDraftWorkspace()`, which is a thin wrapper over the
 * Studio HTTP API.
 *
 * Empty state: when there are no pending drafts we render a muted "saved"
 * state (same slot, just quieter text and disabled buttons) rather than
 * unmounting the whole bar. Disappearing/reappearing shifts the editor's
 * layout and is more jarring than leaving a 40px strip pinned — the muted
 * copy makes it clear there's nothing to do.
 *
 * Preview: for PR 2.6 the local `PGLiteStudioBackend` throws
 * `StudioFeatureUnavailableError` for `buildPreview` which the routes layer
 * maps to HTTP 501 with `{error: 'feature_unavailable'}`. We surface that as
 * an inline message rather than an error, because it's an expected "not
 * wired yet" condition rather than a broken system.
 */

import { useState } from 'react';
import type { PreviewResult, PublishResult } from '../../hooks/useDraftWorkspace';
import { StudioFetchError, useDraftWorkspace, type UseDraftWorkspace } from '../../hooks/useDraftWorkspace';
import { createLogger } from '../../utils/log';
import { DiscardDialog } from './DiscardDialog';
import { PublishDialog } from './PublishDialog';

const log = createLogger('DraftWorkspaceBar');

export interface DraftWorkspaceBarProps {
  /**
   * Optional injection point for tests — passing a pre-built workspace state
   * bypasses the real hook so test code can drive the bar with fixtures
   * without having to mock `fetch`. Production callers should omit this.
   */
  workspace?: UseDraftWorkspace;
}

export function DraftWorkspaceBar({ workspace: injected }: DraftWorkspaceBarProps = {}) {
  // Call the hook unconditionally to keep hook order stable, then pick which
  // value to use. Conditional hook calls would break the rules of hooks; the
  // fake-injection test path accepts a one-time hook call cost here.
  const real = useDraftWorkspace();
  const workspace = injected ?? real;

  const [discardOpen, setDiscardOpen] = useState(false);
  const [publishOpen, setPublishOpen] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [previewBusy, setPreviewBusy] = useState(false);

  const { drafts, count, isLoading, error } = workspace;
  const hasDrafts = count > 0;
  // Most-recent draft's updatedAt, used for the status line ("Saved 2:14 PM").
  const lastUpdated = drafts.reduce<string | null>((acc, d) => {
    if (!acc) return d.updatedAt;
    return d.updatedAt > acc ? d.updatedAt : acc;
  }, null);

  function showStatus(message: string): void {
    setStatus(message);
    // Clear the transient status line after 5s so it doesn't linger.
    window.setTimeout(() => setStatus(null), 5000);
  }

  async function handleDiscardConfirm(): Promise<void> {
    const n = count;
    await workspace.discardAll();
    if (workspace.error) {
      // Error already recorded on the workspace state; surface via bar.
      return;
    }
    setDiscardOpen(false);
    showStatus(`Discarded ${n.toString()} change${n === 1 ? '' : 's'}`);
  }

  async function handlePublishConfirm(commitMessage: string): Promise<PublishResult | null> {
    const result = await workspace.publish(commitMessage);
    if (result) {
      setPublishOpen(false);
      const short = result.commitSha.slice(0, 7);
      showStatus(`Published ${short}`);
    }
    return result;
  }

  async function handlePreview(): Promise<void> {
    setPreviewBusy(true);
    setStatus(null);
    try {
      const result: PreviewResult | null = await workspace.buildPreview();
      if (!result) {
        // Hook stored an error — check it for the 501 feature_unavailable
        // case and show a friendlier message than the raw fetch text.
        const storedErr = workspace.error;
        if (storedErr instanceof StudioFetchError && storedErr.status === 501) {
          showStatus('Preview is not available yet (coming with the cloud backend)');
          return;
        }
        // Fall through — the bar already displays `error` inline below.
        return;
      }
      // Append the preview token to the agent chat URL. For PR 2.6 the
      // runtime isn't yet wired to consume the token so we just open the
      // root chat URL with the token as a query param; PR 2.7 will honor it.
      const url = `/?preview=${encodeURIComponent(result.previewToken)}`;
      window.open(url, '_blank', 'noopener,noreferrer');
      showStatus('Preview opened in new tab');
    } catch (err) {
      log.warn('preview_unexpected_error', { err });
      showStatus('Preview failed');
    } finally {
      setPreviewBusy(false);
    }
  }

  const disabled = !hasDrafts || isLoading;

  return (
    <div className="flex flex-col border-t border-border bg-card text-sm">
      {error && (
        <div className="border-b border-border bg-red-500/10 px-4 py-1.5 text-xs text-red-600 dark:text-red-400">
          {error.message}
        </div>
      )}

      <div className="flex items-center gap-3 px-4 py-2">
        <div className="flex items-center gap-2">
          <span
            className={
              'inline-block h-2 w-2 rounded-full ' +
              (hasDrafts ? 'bg-amber-500' : 'bg-emerald-500/70')
            }
          />
          <span className="text-muted-foreground">
            {hasDrafts
              ? `${count.toString()} unpublished change${count === 1 ? '' : 's'}`
              : 'No pending changes'}
          </span>
          {lastUpdated && hasDrafts && (
            <span className="ml-2 text-[11px] text-muted-foreground">
              updated {new Date(lastUpdated).toLocaleTimeString()}
            </span>
          )}
        </div>

        <div className="ml-auto flex items-center gap-2">
          {status && (
            <span className="text-xs text-muted-foreground">{status}</span>
          )}
          {isLoading && (
            <span className="text-xs text-muted-foreground">Working...</span>
          )}

          <button
            type="button"
            onClick={() => setDiscardOpen(true)}
            disabled={disabled}
            className="rounded px-3 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50"
          >
            Discard
          </button>

          <button
            type="button"
            onClick={() => void handlePreview()}
            disabled={disabled || previewBusy}
            className="rounded border border-border px-3 py-1 text-xs text-foreground hover:bg-muted disabled:opacity-50"
          >
            {previewBusy ? 'Preview...' : 'Preview'}
          </button>

          <button
            type="button"
            onClick={() => setPublishOpen(true)}
            disabled={disabled}
            className="rounded bg-primary-solid px-3 py-1 text-xs text-white disabled:opacity-50"
          >
            Publish
          </button>
        </div>
      </div>

      {discardOpen && (
        <DiscardDialog
          count={count}
          onCancel={() => setDiscardOpen(false)}
          onConfirm={handleDiscardConfirm}
        />
      )}

      {publishOpen && (
        <PublishDialog
          drafts={drafts}
          onCancel={() => setPublishOpen(false)}
          onConfirm={handlePublishConfirm}
        />
      )}
    </div>
  );
}
