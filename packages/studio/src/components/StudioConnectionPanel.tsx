/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

/**
 * In-chat connection panel renderer.
 *
 * Renders the states stamped on a `connection_panel` block:
 *   - `idle` — Configure / Later (Later only when `skippable: true`)
 *   - `success` — ✓ Configured + optional inline data point
 *   - `skipped` — "Later" pill + Configure to reopen
 *   - `error` — error message + Configure to retry
 *
 * `state` is a cache refreshed when the chat mounts; only `userSkipped`
 * survives reload. This renderer reads it only for the visible pill.
 *
 * Click Configure → opens `<ConnectionConfigModal>` which fetches
 * the package's auth metadata, renders the OAuth/paste/basic form
 * via `<ConnectionConfigForm>`, polls `popup.closed`, and on success
 * dispatches `PANEL_UPDATE` here + posts `Configured {displayName}`
 * to the chat.
 *
 * Click Later → posts `Skip {displayName} for now` as the next user
 * turn, sets `meta.userSkipped: true`, and dispatches
 * `PANEL_UPDATE` with `state: 'skipped'`. The panel persists across
 * reload because `userSkipped` is the only field that does.
 */

import { useState } from 'react';
import type { BlockRendererProps, ConnectionPanelBlock } from '@amodalai/react';
import { ConnectionConfigModal } from './ConnectionConfigModal';

export function StudioConnectionPanel({
  block,
  dispatch,
  postUserMessage,
}: BlockRendererProps<ConnectionPanelBlock>) {
  const [modalOpen, setModalOpen] = useState(false);

  const onConfigure = (): void => {
    setModalOpen(true);
  };

  const onLater = (): void => {
    postUserMessage(`Skip ${block.displayName} for now`);
    dispatch({
      type: 'PANEL_UPDATE',
      panelId: block.panelId,
      patch: { state: 'skipped', userSkipped: true },
    });
  };

  const onConfigured = ({ displayName }: { packageName: string; displayName: string }): void => {
    setModalOpen(false);
    postUserMessage(`Configured ${displayName}`);
    dispatch({
      type: 'PANEL_UPDATE',
      panelId: block.panelId,
      patch: { state: 'success' },
    });
  };

  const isSuccess = block.state === 'success';
  const isSkipped = block.state === 'skipped';
  const isError = block.state === 'error';
  const settled = isSuccess || isSkipped;

  return (
    <>
      <div
        className={`studio-connection-panel${settled ? ' studio-connection-panel--settled' : ''}`}
        data-state={block.state}
      >
        <div className="studio-connection-panel__main">
          <div className="studio-connection-panel__text">
            <div className="studio-connection-panel__name">{block.displayName}</div>
            <div className="studio-connection-panel__description">{block.description}</div>
            {isError && block.errorMessage && (
              <div className="studio-connection-panel__error">{block.errorMessage}</div>
            )}
            {isSuccess && block.successDetail && (
              <div className="studio-connection-panel__success-detail">{block.successDetail}</div>
            )}
          </div>
          <div className="studio-connection-panel__actions">
            {isSuccess ? (
              <span className="studio-connection-panel__pill studio-connection-panel__pill--success">
                ✓ Configured
              </span>
            ) : isSkipped ? (
              <>
                <span className="studio-connection-panel__pill studio-connection-panel__pill--skipped">
                  Later
                </span>
                <button
                  type="button"
                  onClick={onConfigure}
                  className="studio-connection-panel__btn studio-connection-panel__btn--secondary"
                >
                  Configure
                </button>
              </>
            ) : (
              <>
                <button
                  type="button"
                  onClick={onConfigure}
                  className="studio-connection-panel__btn studio-connection-panel__btn--primary"
                >
                  {isError ? 'Retry' : 'Configure'}
                </button>
                {block.skippable && !isError && (
                  <button
                    type="button"
                    onClick={onLater}
                    className="studio-connection-panel__btn studio-connection-panel__btn--ghost"
                  >
                    Later
                  </button>
                )}
              </>
            )}
          </div>
        </div>
      </div>

      <ConnectionConfigModal
        open={modalOpen}
        packageName={block.packageName}
        displayName={block.displayName}
        onCancel={() => setModalOpen(false)}
        onConfigured={onConfigured}
      />
    </>
  );
}
