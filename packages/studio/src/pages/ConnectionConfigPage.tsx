/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { AgentOffline } from '@/components/AgentOffline';
import { useStudioConfig } from '../contexts/StudioConfigContext';
import { useConnectionDetail, type ConnectionDetail } from '../hooks/useConnectionDetail';

/**
 * Per-connection configure page — `/agents/:agentId/connections/:packageName`.
 *
 * Reached by clicking a package's name from Getting Started or Secrets.
 * Renders different forms based on the package's declared `auth.type`:
 *
 *   - `bearer` / `api-key` — single password input (or one per envVar
 *     when the package declares multiple). OAuth Connect button shown
 *     in parallel when `amodal.oauth` is configured + creds set.
 *   - `oauth`-only — Connect button + scopes preview. Manual paste
 *     hidden (the package doesn't expect it).
 *   - `basic` — username + password split fields.
 *   - Anything else — generic per-envVar paste form.
 *
 * Saves go through `POST /api/secrets/:name`. OAuth Connect goes through
 * the same runtime flow Getting Started uses.
 */
export function ConnectionConfigPage() {
  const { packageName: encoded } = useParams<{ packageName: string }>();
  const packageName = decodeURIComponent(encoded ?? '');
  const { runtimeUrl } = useStudioConfig();
  const { data, error, loading, saveSecret } = useConnectionDetail(packageName);
  const [savingName, setSavingName] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [saveError, setSaveError] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [connectError, setConnectError] = useState<string | null>(null);
  const [showPasteFallback, setShowPasteFallback] = useState(false);

  if (error) return <AgentOffline page="connection" detail={error} />;
  if (loading || !data) return null;

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
    if (!data?.oauth?.available || connecting) return;
    setConnecting(true);
    setConnectError(null);
    try {
      const r = await fetch(
        `${runtimeUrl}/api/oauth/start?package=${encodeURIComponent(packageName)}`,
        {signal: AbortSignal.timeout(5_000)},
      );
      if (!r.ok) {
        const text = await r.text().catch(() => '');
        throw new Error(`${String(r.status)}${text ? ` — ${text}` : ''}`);
      }
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- system boundary
      const { authorizeUrl } = (await r.json()) as { authorizeUrl: string };
      window.location.href = authorizeUrl;
    } catch (err) {
      setConnectError(err instanceof Error ? err.message : String(err));
      setConnecting(false);
    }
  }

  const allEnvVarsSet = data.envVars.length > 0 && data.envVars.every((v) => v.set);
  const fulfilled = allEnvVarsSet;

  return (
    <div className="space-y-6 max-w-3xl">
      <Link
        to="../getting-started"
        className="text-xs text-muted-foreground hover:text-foreground"
      >
        ← Back to getting started
      </Link>

      <header className="flex items-start gap-4">
        {data.icon ? (
          <img src={data.icon} alt="" className="w-12 h-12 rounded shrink-0" />
        ) : (
          <span className="w-12 h-12 rounded bg-muted shrink-0" />
        )}
        <div className="flex-1 min-w-0">
          <h1 className="text-xl font-semibold text-foreground">{data.displayName}</h1>
          <p className="text-[11px] font-mono text-muted-foreground truncate">{data.name}</p>
          {data.description && (
            <p className="text-sm text-muted-foreground mt-2">{data.description}</p>
          )}
        </div>
        {fulfilled && (
          <span className="text-xs text-emerald-600 dark:text-emerald-400 px-2 py-1 rounded bg-emerald-500/10 whitespace-nowrap">
            ✓ Configured
          </span>
        )}
      </header>

      {saveError && (
        <div className="rounded-md border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          {saveError}
        </div>
      )}

      {/* Render exactly one primary surface based on what's actionable.
          - OAuth available (creds set in env): big OAuth panel; paste is
            an optional fallback behind a toggle.
          - OAuth declared but creds missing: small banner pointing at
            the env vars to set; paste shown as the actionable path.
          - No OAuth: paste shown alone. */}
      {(() => {
        const oauthAvailable = !!data.oauth?.available;
        const fulfilledViaPaste =
          data.envVars.length > 0 && data.envVars.every((v) => v.set);
        if (oauthAvailable) {
          return (
            <>
              <OAuthSection
                data={data}
                connecting={connecting}
                connectError={connectError}
                onConnect={() => void handleConnect()}
              />
              {!fulfilledViaPaste && !showPasteFallback && (
                <button
                  type="button"
                  onClick={() => setShowPasteFallback(true)}
                  className="text-xs text-muted-foreground hover:text-foreground underline"
                >
                  Or paste credentials manually
                </button>
              )}
              {(showPasteFallback || fulfilledViaPaste) &&
                renderAuthForm(data, drafts, setDrafts, savingName, handleSave)}
            </>
          );
        }
        return (
          <>
            {data.oauth && <OAuthHint data={data} />}
            {renderAuthForm(data, drafts, setDrafts, savingName, handleSave)}
          </>
        );
      })()}

      <div className="pt-4 border-t border-border text-xs text-muted-foreground">
        Auth type from <code className="font-mono">amodal.auth.type</code>:{' '}
        <span className="font-mono text-foreground">{data.authType}</span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// OAuth panel — shown whenever amodal.oauth is declared
// ---------------------------------------------------------------------------

/**
 * Compact banner shown when the package declares OAuth but the user
 * hasn't set CLIENT_ID/_SECRET in env yet. Replaces the full OAuth
 * panel for this state — OAuth isn't actionable yet, so paste is the
 * primary path; this just signals OAuth is available once configured.
 */
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

// ---------------------------------------------------------------------------
// Render form by auth type
// ---------------------------------------------------------------------------

function renderAuthForm(
  data: ConnectionDetail,
  drafts: Record<string, string>,
  setDrafts: (updater: (cur: Record<string, string>) => Record<string, string>) => void,
  savingName: string | null,
  handleSave: (name: string) => Promise<void>,
): React.ReactNode {
  const { authType, envVars } = data;

  if (envVars.length === 0) {
    return null;
  }

  // Heading copy depends on whether OAuth is the primary path.
  const oauthIsPrimary = !!data.oauth?.available;
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
                    onClick={() => void handleSave(v.name)}
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
