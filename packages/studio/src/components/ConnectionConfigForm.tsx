/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

/**
 * Shared connection auth-form rendering — Phase H.5 of the
 * admin-setup build plan. Used by:
 *
 *   - `<ConnectionConfigPage>` (power-user flow at
 *     `/agents/:id/connections/:packageName`)
 *   - `<ConnectionConfigModal>` (Phase H.4 — opened by
 *     `<StudioConnectionPanel>` from chat)
 *
 * Renders one of three layouts based on `auth.type`:
 *   - `bearer` / `api-key` — paste fields per envVar
 *   - `basic` — username + password split fields
 *   - everything else — generic per-envVar paste rows
 *
 * Plus an OAuth section (Connect button + scope preview) when
 * `amodal.oauth` is declared and credentials are set in env. The
 * page wraps this with surrounding chrome (back link, header,
 * footer); the modal wraps it with its own header/close button.
 */

import { useState } from 'react';
import { useStudioConfig } from '../contexts/StudioConfigContext';
import type { ConnectionDetail } from '../hooks/useConnectionDetail';

interface ConnectionConfigFormProps {
  data: ConnectionDetail;
  saveSecret: (name: string, value: string) => Promise<void>;
  /**
   * Called when the user starts an OAuth Connect. The form opens a
   * popup to the runtime's authorize URL; the embedder is responsible
   * for detecting popup closure and refetching `data` to confirm
   * the env-vars landed. Returns the popup window handle so the
   * embedder can poll `popup.closed`.
   */
  onOAuthPopup?: (popup: Window) => void;
}

export function ConnectionConfigForm({
  data,
  saveSecret,
  onOAuthPopup,
}: ConnectionConfigFormProps) {
  const { runtimeUrl } = useStudioConfig();
  const [savingName, setSavingName] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [saveError, setSaveError] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [connectError, setConnectError] = useState<string | null>(null);
  const [showPasteFallback, setShowPasteFallback] = useState(false);

  async function handleSave(name: string): Promise<void> {
    const value = (drafts[name] ?? '').trim();
    if (!value || savingName) return;
    setSavingName(name);
    setSaveError(null);
    try {
      await saveSecret(name, value);
      setDrafts((cur) => {
        const next = { ...cur };
        delete next[name];
        return next;
      });
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : String(err));
    } finally {
      setSavingName(null);
    }
  }

  async function handleConnect(): Promise<void> {
    if (!data.oauth?.available || connecting) return;
    setConnecting(true);
    setConnectError(null);
    try {
      const r = await fetch(
        `${runtimeUrl}/api/oauth/start?package=${encodeURIComponent(data.name)}`,
        { signal: AbortSignal.timeout(5_000) },
      );
      if (!r.ok) {
        const text = await r.text().catch(() => '');
        throw new Error(`${String(r.status)}${text ? ` — ${text}` : ''}`);
      }
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- system boundary
      const { authorizeUrl } = (await r.json()) as { authorizeUrl: string };

      // Modal flow opens a popup so the modal stays mounted to detect
      // closure. Page flow falls back to a full-page redirect.
      if (onOAuthPopup) {
        const popup = window.open(authorizeUrl, 'amodal-oauth', 'width=600,height=700');
        if (popup) {
          onOAuthPopup(popup);
        } else {
          // Popup blocked — fall back to a same-tab redirect.
          window.location.href = authorizeUrl;
        }
        // Re-enable the button so users can retry if they close the
        // popup without authorizing. The modal's polling effect will
        // dismiss us on success.
        setConnecting(false);
      } else {
        window.location.href = authorizeUrl;
      }
    } catch (err) {
      setConnectError(err instanceof Error ? err.message : String(err));
      setConnecting(false);
    }
  }

  const oauthAvailable = !!data.oauth?.available;
  const fulfilledViaPaste = data.envVars.length > 0 && data.envVars.every((v) => v.set);
  // Hide the "paste credentials manually" toggle for OAuth-only
  // packages with no envVars to paste into — there's nothing to
  // expand. Build plan H.4: "OAuth-only — Connect button + scopes
  // preview. Manual paste hidden (the package doesn't expect it)."
  const hasPasteFields = data.envVars.length > 0;

  return (
    <div className="space-y-4">
      {saveError && (
        <div className="rounded-md border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          {saveError}
        </div>
      )}

      {oauthAvailable && (
        <OAuthSection
          data={data}
          connecting={connecting}
          connectError={connectError}
          onConnect={() => void handleConnect()}
        />
      )}

      {oauthAvailable && hasPasteFields && !fulfilledViaPaste && !showPasteFallback && (
        <button
          type="button"
          onClick={() => setShowPasteFallback(true)}
          className="text-xs text-muted-foreground hover:text-foreground underline"
        >
          Or paste credentials manually
        </button>
      )}

      {!oauthAvailable && data.oauth && <OAuthHint data={data} />}

      {(!oauthAvailable || showPasteFallback || fulfilledViaPaste) && (
        <PasteSection
          data={data}
          drafts={drafts}
          setDrafts={setDrafts}
          savingName={savingName}
          handleSave={(n) => void handleSave(n)}
          oauthIsPrimary={oauthAvailable}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// OAuth panel
// ---------------------------------------------------------------------------

function OAuthSection({
  data,
  connecting,
  connectError,
  onConnect,
}: {
  data: ConnectionDetail;
  connecting: boolean;
  connectError: string | null;
  onConnect: () => void;
}) {
  if (!data.oauth?.available) return null;
  return (
    <section className="rounded-lg border border-border bg-card p-5 space-y-3">
      <div>
        <div className="font-medium text-sm">Connect with OAuth</div>
        <p className="text-xs text-muted-foreground mt-1">
          One-click flow brokered locally — runtime mints the access token and
          stores it as <code className="font-mono">{data.oauth.appKey}</code>&apos;s declared secret.
        </p>
      </div>
      {data.oauth.scopes && data.oauth.scopes.length > 0 && (
        <div className="text-xs">
          <span className="text-muted-foreground">Will request scopes:</span>{' '}
          <span className="font-mono text-foreground">
            {data.oauth.scopes.join(', ')}
          </span>
        </div>
      )}
      <button
        type="button"
        onClick={onConnect}
        disabled={connecting}
        className="px-4 py-2 rounded bg-primary-solid text-white text-sm font-medium hover:opacity-90 disabled:opacity-50"
      >
        {connecting ? 'Opening…' : `Connect ${data.oauth.appKey}`}
      </button>
      {connectError && (
        <div className="text-xs text-destructive">OAuth start failed: {connectError}</div>
      )}
    </section>
  );
}

function OAuthHint({ data }: { data: ConnectionDetail }) {
  if (!data.oauth) return null;
  const upper = data.oauth.appKey.toUpperCase().replace(/-/g, '_');
  return (
    <div className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-900 dark:text-amber-200">
      💡 This connection supports OAuth.
      Set <code className="font-mono">{upper}_CLIENT_ID</code> and{' '}
      <code className="font-mono">{upper}_CLIENT_SECRET</code> in your env (and register{' '}
      <code className="font-mono">/api/oauth/callback</code> as the redirect URI on your{' '}
      {data.oauth.appKey} OAuth app) to enable a Connect button — otherwise paste a token below.
    </div>
  );
}

// ---------------------------------------------------------------------------
// Paste section
// ---------------------------------------------------------------------------

function PasteSection({
  data,
  drafts,
  setDrafts,
  savingName,
  handleSave,
  oauthIsPrimary,
}: {
  data: ConnectionDetail;
  drafts: Record<string, string>;
  setDrafts: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  savingName: string | null;
  handleSave: (name: string) => void;
  oauthIsPrimary: boolean;
}) {
  const { authType, envVars } = data;
  if (envVars.length === 0) return null;

  const heading = oauthIsPrimary ? 'Or paste credentials manually' : 'Paste credentials';
  const subhead =
    authType === 'basic'
      ? 'This connection uses HTTP Basic auth — paste both username and password.'
      : authType === 'bearer' || authType === 'api-key'
        ? 'Paste each value below. Each is stored as an agent secret and never displayed back.'
        : 'Each row is an environment variable the package reads at runtime.';

  return (
    <section className="rounded-lg border border-border bg-card p-5 space-y-4">
      <div>
        <div className="font-medium text-sm">{heading}</div>
        <p className="text-xs text-muted-foreground mt-1">{subhead}</p>
      </div>
      <div className="space-y-3">
        {envVars.map((v) => {
          const draft = drafts[v.name] ?? '';
          return (
            <div key={v.name}>
              <label className="block text-xs font-mono mb-1">
                {v.name}
                {v.set && (
                  <span className="ml-2 text-emerald-600 dark:text-emerald-400 font-sans">✓ Set</span>
                )}
              </label>
              <p className="text-[11px] text-muted-foreground mb-1.5">{v.description}</p>
              {!v.set && (
                <div className="flex gap-2">
                  <input
                    type="password"
                    value={draft}
                    onChange={(e) =>
                      setDrafts((cur) => ({ ...cur, [v.name]: e.target.value }))
                    }
                    placeholder="Paste value"
                    className="flex-1 px-3 py-2 rounded border border-border bg-background text-sm focus:outline-none focus:ring-1 focus:ring-ring"
                  />
                  <button
                    type="button"
                    onClick={() => handleSave(v.name)}
                    disabled={!draft.trim() || savingName === v.name}
                    className="px-3 py-2 rounded bg-primary-solid text-white text-sm font-medium hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {savingName === v.name ? 'Saving…' : 'Save'}
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
