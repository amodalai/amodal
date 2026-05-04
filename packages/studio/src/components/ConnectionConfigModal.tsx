/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

/**
 * In-chat Configure modal — Phase H.4 of the admin-setup build plan.
 *
 * Opened by `<StudioConnectionPanel>` when the user clicks Configure.
 * Fetches the package's auth metadata via `useConnectionDetail` and
 * renders the shared `<ConnectionConfigForm>` (Phase H.5) inside a
 * modal frame. On success — every required envVar set — the modal
 * dismisses itself and reports back to the panel via `onConfigured`.
 *
 * OAuth flow: when the user clicks Connect, the form opens a popup
 * to the runtime's authorize URL. The modal polls `popup.closed`
 * (every 500ms) and refetches `data` once the popup goes away. If
 * the refetched data shows `envVars` are now set, the modal
 * dismisses and fires `onConfigured`. While the popup is open the
 * modal contents `display: none` so they don't sit behind the
 * authorize page; the outer container stays mounted to keep the
 * polling interval alive.
 */

import { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { ConnectionConfigForm } from './ConnectionConfigForm';
import { useConnectionDetail } from '../hooks/useConnectionDetail';

interface ConnectionConfigModalProps {
  open: boolean;
  packageName: string;
  /** Optional human-readable name. When omitted, the data fetch supplies it. */
  displayName?: string;
  /** Close clicked or backdrop clicked. */
  onCancel: () => void;
  /**
   * Fired once the connection is fully configured (every required
   * envVar is set). The `displayName` is the human label the panel
   * should reference in its "Configured X" user-message post.
   */
  onConfigured: (info: { packageName: string; displayName: string }) => void;
}

const POLL_INTERVAL_MS = 500;

export function ConnectionConfigModal({
  open,
  packageName,
  displayName: externalDisplayName,
  onCancel,
  onConfigured,
}: ConnectionConfigModalProps) {
  const { data, error, loading, saveSecret, refetch } = useConnectionDetail(open ? packageName : '');
  const [popup, setPopup] = useState<Window | null>(null);
  const onConfiguredRef = useRef(onConfigured);
  onConfiguredRef.current = onConfigured;

  // Poll popup.closed when an OAuth Connect is in flight. When the
  // popup closes, refetch the package detail to see if the env-vars
  // landed. Refetch happens regardless of whether the user authorized
  // — if they cancelled, data.envVars stays unset and the form
  // re-enables Connect for retry.
  useEffect(() => {
    if (!popup) return;
    const id = window.setInterval(() => {
      if (popup.closed) {
        window.clearInterval(id);
        setPopup(null);
        refetch();
      }
    }, POLL_INTERVAL_MS);
    return () => {
      window.clearInterval(id);
    };
  }, [popup, refetch]);

  // Listen for the `amodal:oauth:done` postMessage Studio's callback
  // emits from inside the popup. This fires regardless of whether
  // `window.close()` succeeds (which browsers can block in some
  // configurations), so the modal can refetch immediately instead of
  // sitting on a stale state until the user closes the popup manually.
  useEffect(() => {
    if (!popup) return;
    function onMessage(event: MessageEvent): void {
      // Same-origin only — Studio's callback runs on the same origin
      // as the parent. Cross-origin messages from the OAuth provider
      // (which the popup hits before the callback) are ignored.
      if (event.origin !== window.location.origin) return;
      const data: unknown = event.data;
      if (typeof data !== 'object' || data === null) return;
       
      const msg = data as { type?: unknown };
      if (msg.type !== 'amodal:oauth:done') return;
      // Try to close the popup from the parent side (parents have more
      // permissive close access than the popup does for window.close()).
      try { popup.close(); } catch { /* ignore */ }
      setPopup(null);
      refetch();
    }
    window.addEventListener('message', onMessage);
    return () => {
      window.removeEventListener('message', onMessage);
    };
  }, [popup, refetch]);

  // Auto-dismiss when the connection is fully configured. Watches
  // `data.envVars` (refetched after popup close or after a paste-save)
  // and fires `onConfigured` exactly once per modal open.
  const firedRef = useRef(false);
  useEffect(() => {
    if (!open) {
      firedRef.current = false;
      return;
    }
    if (!data || firedRef.current) return;
    const fulfilled = data.envVars.length > 0 && data.envVars.every((v) => v.set);
    if (!fulfilled) return;
    firedRef.current = true;
    onConfiguredRef.current({
      packageName: data.name,
      displayName: data.displayName || externalDisplayName || data.name,
    });
  }, [open, data, externalDisplayName]);

  if (!open) return null;

  // While a popup is in flight, hide the modal contents but keep the
  // outer container mounted so the polling effect survives. Backdrop
  // click still dismisses (which cancels the connect attempt cleanly
  // since the popup polling effect cleans up on unmount).
  const popupOpen = popup !== null && !popup.closed;

  return (
    <div
      className="studio-connection-modal__backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
      role="dialog"
      aria-modal="true"
      aria-label="Configure connection"
    >
      <div className="studio-connection-modal" style={popupOpen ? { display: 'none' } : undefined}>
        <header className="studio-connection-modal__header">
          <div className="studio-connection-modal__header-text">
            <h2 className="studio-connection-modal__title">
              Configure {data?.displayName ?? externalDisplayName ?? packageName}
            </h2>
            {data?.description && (
              <p className="studio-connection-modal__description">{data.description}</p>
            )}
          </div>
          <button
            type="button"
            onClick={onCancel}
            className="studio-connection-modal__close"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </header>
        <div className="studio-connection-modal__body">
          {error && (
            <div className="studio-connection-modal__error">
              Couldn&apos;t load connection details: {error}
            </div>
          )}
          {!error && loading && (
            <div className="studio-connection-modal__loading">Loading…</div>
          )}
          {!error && data && (
            <ConnectionConfigForm
              data={data}
              saveSecret={saveSecret}
              onOAuthPopup={(p) => setPopup(p)}
            />
          )}
        </div>
      </div>
    </div>
  );
}
