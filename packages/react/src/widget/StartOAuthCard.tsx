/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import { useState } from 'react';
import type { StartOAuthBlock } from '../types';

interface Props {
  block: StartOAuthBlock;
  /** Optional callback to post the user's "Later" decision back to the chat
   *  as a normal user turn so the agent can continue the setup flow. */
  sendMessage?: (text: string) => void;
}

const POPUP_FEATURES = 'width=600,height=700,resizable=yes,scrollbars=yes';
const OAUTH_START_TIMEOUT_MS = 10_000;

/**
 * Inline connection card emitted by the admin agent's
 * `start_oauth_connection` tool. Shows the connection name + description
 * with a Connect button (and an optional "Later" skip button when
 * `skippable` is true). Click → `/api/oauth/start?package=…` (the runtime
 * broker for OSS, platform-api proxy in cloud) → opens the provider's
 * authorize URL in a popup.
 *
 * State machine:
 *   idle       → user has done nothing
 *   opening    → POSTing to /api/oauth/start
 *   opened     → popup launched, user is authorizing
 *   connected  → user confirmed completion (popup closed itself)
 *   skipped    → user clicked Later
 *   error      → start endpoint or popup failed
 */
export function StartOAuthCard({ block, sendMessage }: Props) {
  const [status, setStatus] = useState<
    'idle' | 'opening' | 'opened' | 'connected' | 'skipped' | 'error'
  >('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const name = block.displayName ?? block.packageName;
  const description = block.description;

  const onConnect = async (): Promise<void> => {
    setStatus('opening');
    setErrorMessage(null);
    try {
      const url = `/api/oauth/start?package=${encodeURIComponent(block.packageName)}`;
      const res = await fetch(url, { signal: AbortSignal.timeout(OAUTH_START_TIMEOUT_MS) });
      if (!res.ok) {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- system boundary: parsing API error
        const err = (await res.json().catch(() => ({}))) as { error?: string };
        setErrorMessage(err.error ?? `OAuth start returned ${String(res.status)}`);
        setStatus('error');
        return;
      }
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- system boundary: parsing API response
      const data = (await res.json()) as { authorizeUrl?: string };
      if (!data.authorizeUrl) {
        setErrorMessage('OAuth start response missing authorizeUrl');
        setStatus('error');
        return;
      }
      const popup = window.open(data.authorizeUrl, '_blank', POPUP_FEATURES);
      if (!popup) {
        // Popup blocked — fall back to same-tab navigation.
        window.location.href = data.authorizeUrl;
      }
      setStatus('opened');
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'OAuth start failed');
      setStatus('error');
    }
  };

  const onSkip = (): void => {
    setStatus('skipped');
    sendMessage?.(`Skip ${name} for now`);
  };

  const onMarkConnected = (): void => {
    setStatus('connected');
    sendMessage?.(`Connected ${name}`);
  };

  const isConnected = status === 'connected';
  const isSkipped = status === 'skipped';

  return (
    <div className="pcw-oauth-row">
      <div className="pcw-oauth-row__head">
        <div className="pcw-oauth-row__title">
          <span className="pcw-oauth-row__name">{name}</span>
          {description && (
            <span className="pcw-oauth-row__desc">— {description}</span>
          )}
        </div>
        {isConnected && (
          <span className="pcw-oauth-row__status pcw-oauth-row__status--ok">
            ✓ Connected
          </span>
        )}
        {isSkipped && (
          <span className="pcw-oauth-row__status pcw-oauth-row__status--muted">
            Skipped — connect later
          </span>
        )}
      </div>

      {!isConnected && !isSkipped && (
        <div className="pcw-oauth-row__actions">
          {status === 'opened' ? (
            <>
              <span className="pcw-oauth-row__hint">
                Window opened — finish in the popup.
              </span>
              <button
                type="button"
                className="pcw-oauth-row__connect"
                onClick={onMarkConnected}
              >
                I&apos;m done
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                className="pcw-oauth-row__connect"
                onClick={() => { void onConnect(); }}
                disabled={status === 'opening'}
              >
                {status === 'opening' ? 'Opening…' : `Connect ${name}`}
              </button>
              {block.skippable && (
                <button
                  type="button"
                  className="pcw-oauth-row__skip"
                  onClick={onSkip}
                  disabled={status === 'opening'}
                >
                  Later
                </button>
              )}
              {status === 'error' && errorMessage && (
                <span className="pcw-oauth-row__error">{errorMessage}</span>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
