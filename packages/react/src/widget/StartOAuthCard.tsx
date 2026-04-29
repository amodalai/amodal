/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import { useState } from 'react';
import type { StartOAuthBlock } from '../types';

interface Props {
  block: StartOAuthBlock;
}

const POPUP_FEATURES = 'width=600,height=700,resizable=yes,scrollbars=yes';
const OAUTH_START_TIMEOUT_MS = 10_000;

/**
 * Inline OAuth Connect button. Click hits `/api/oauth/start?package=…` (the
 * runtime broker for OSS, platform-api proxy in cloud) and opens the
 * provider's authorize URL in a popup. The widget doesn't own the redirect
 * back — the runtime callback redirects Studio's getting-started page,
 * which the user can ignore now that the chat is the primary surface.
 */
export function StartOAuthCard({ block }: Props) {
  const [status, setStatus] = useState<'idle' | 'opening' | 'opened' | 'error'>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const label = block.displayName ?? `Connect ${block.packageName}`;

  const onClick = async (): Promise<void> => {
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

  if (status === 'opened') {
    return (
      <div className="pcw-oauth pcw-oauth--opened">
        <span className="pcw-oauth__label">{label}</span>
        <span className="pcw-oauth__status">Window opened — finish in the popup, then come back.</span>
      </div>
    );
  }

  return (
    <div className="pcw-oauth">
      <button
        type="button"
        className="pcw-oauth__btn"
        onClick={() => { void onClick(); }}
        disabled={status === 'opening'}
      >
        {status === 'opening' ? 'Opening…' : label}
      </button>
      {status === 'error' && errorMessage && (
        <span className="pcw-oauth__error">{errorMessage}</span>
      )}
    </div>
  );
}
