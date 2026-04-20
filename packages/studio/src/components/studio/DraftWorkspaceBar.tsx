/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

/**
 * DraftWorkspaceBar — pinned bar at the bottom of the files editor showing
 * the draft count and Discard / Preview / Publish actions.
 *
 * Simplified for Studio: uses direct same-origin fetch via useDraftWorkspace
 * instead of the StudioContext / studio-client chain.
 */

import { useState } from 'react';
import type { PreviewResult, PublishResult } from '@/lib/types';
import { StudioFetchError, useDraftWorkspace, type UseDraftWorkspace } from '@/hooks/useDraftWorkspace';
import { createBrowserLogger } from '@/lib/browser-logger';
import { DiscardDialog } from './DiscardDialog';
import { PublishDialog } from './PublishDialog';

const log = createBrowserLogger('DraftWorkspaceBar');

export interface DraftWorkspaceBarProps {
  /**
   * Optional injection point for tests — passing a pre-built workspace state
   * bypasses the real hook so test code can drive the bar with fixtures.
   */
  workspace?: UseDraftWorkspace;
}

export function DraftWorkspaceBar({ workspace: injected }: DraftWorkspaceBarProps) {
  const real = useDraftWorkspace();
  const workspace = injected ?? real;

  const [discardOpen, setDiscardOpen] = useState(false);
  const [publishOpen, setPublishOpen] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [previewBusy, setPreviewBusy] = useState(false);

  const { drafts, count, isLoading, error } = workspace;
  const hasDrafts = count > 0;
  const lastUpdated = drafts.reduce<string | null>((acc, d) => {
    if (!acc) return d.updatedAt;
    return d.updatedAt > acc ? d.updatedAt : acc;
  }, null);

  function showStatus(message: string): void {
    setStatus(message);
    window.setTimeout(() => setStatus(null), 5000);
  }

  async function handleDiscardConfirm(): Promise<void> {
    const n = count;
    await workspace.discardAll();
    if (workspace.error) {
      return;
    }
    setDiscardOpen(false);
    showStatus(`Discarded ${n.toString()} change${n === 1 ? '' : 's'}`);
  }

  async function handlePublishConfirm(commitMessage: string): Promise<PublishResult | null> {
    const result = await workspace.publish(commitMessage);
    if (result) {
      setPublishOpen(false);
      const short = result.commitRef.slice(0, 7);
      showStatus(`Published ${short}`);
    }
    return result;
  }

  async function handlePreview(): Promise<void> {
    setPreviewBusy(true);
    setStatus(null);
    try {
      showStatus('Creating preview branch...');
      const result: PreviewResult | null = await workspace.buildPreview();
      if (!result) {
        const storedErr = workspace.getLatestError();
        if (storedErr instanceof StudioFetchError && storedErr.status === 501) {
          showStatus('Preview is only available in cloud. Publish to see changes locally.');
          await workspace.listDrafts();
          return;
        }
        showStatus('Preview failed');
        return;
      }

      // Token-based preview (legacy)
      if (result.token) {
        const url = `/?preview=${encodeURIComponent(result.token)}`;
        window.open(url, '_blank', 'noopener,noreferrer');
        showStatus('Preview opened in new tab');
        return;
      }

      // Branch-based preview
      if (result.branch) {
        showStatus(`Preview branch created: ${result.branch}`);
      }
    } catch (err) {
      log.warn('preview_unexpected_error', { err: err instanceof Error ? err.message : String(err) });
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
