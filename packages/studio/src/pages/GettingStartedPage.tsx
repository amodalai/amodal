/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import { useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { AgentOffline } from '@/components/AgentOffline';
import { useStudioConfig } from '../contexts/StudioConfigContext';
import {
  useGettingStarted,
  type GettingStartedPackage,
  type TemplateConnectionSlot,
} from '../hooks/useGettingStarted';

/**
 * Getting Started — `/agents/:agentId/getting-started`.
 *
 * Two render modes, both backed by the runtime's `/api/getting-started`:
 *
 *   1. **Templated agent** (template.json present in the repo) — slots
 *      from `template.connections`, each showing the curated providers
 *      and their fulfillment status.
 *   2. **No template** — flat list of every connection package the
 *      agent has installed, grouped by package, with each declared
 *      env-var's set/unset status.
 *
 * The page is read-only today: it surfaces what needs to be configured
 * but doesn't yet write secrets inline. Sally pastes credentials via
 * the Secrets tab (or admin chat) and refreshes here to see ✓ flip on.
 */
export function GettingStartedPage() {
  const { data, error, loading, refetch } = useGettingStarted();
  const callback = useOAuthCallbackBanner();

  if (error) return <AgentOffline page="getting-started" detail={error} />;
  if (loading || !data) return null;

  const { template, packages } = data;
  const packagesByName = new Map(packages.map((p) => [p.name, p]));

  return (
    <div className="space-y-8 max-w-3xl">
      <header>
        <h1 className="text-xl font-semibold text-foreground">Getting started</h1>
        <p className="text-sm text-muted-foreground mt-1">
          {template
            ? `Configure the connections this template needs. Each row shows the providers you can pick from and what credentials they require.`
            : `Configure the connections this agent depends on. Each card lists the credentials a package declares; ✓ means the secret is set in the runtime's environment.`}
        </p>
      </header>

      {callback}

      {template && template.connections && template.connections.length > 0 && (
        <SlotList slots={template.connections} packagesByName={packagesByName} />
      )}

      {(!template || !template.connections || template.connections.length === 0) && (
        <FlatPackageList packages={packages} />
      )}

      <div className="pt-4 border-t border-border">
        <button
          type="button"
          onClick={refetch}
          className="text-xs text-muted-foreground hover:text-foreground"
        >
          ↻ Refresh status
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Templated mode: slot accordion (one row per template.connections[])
// ---------------------------------------------------------------------------

function SlotList({
  slots,
  packagesByName,
}: {
  slots: TemplateConnectionSlot[];
  packagesByName: Map<string, GettingStartedPackage>;
}) {
  return (
    <div className="space-y-2">
      {slots.map((slot) => {
        const slotFulfilled = slot.options.some((o) => packagesByName.get(o)?.isFulfilled);
        return (
          <div key={slot.label} className="rounded-lg border border-border bg-card overflow-hidden">
            <div className="px-4 py-3 border-b border-border">
              <div className="flex items-center gap-2">
                <span className={slotFulfilled ? 'text-emerald-600 dark:text-emerald-400' : 'text-muted-foreground'}>
                  {slotFulfilled ? '✓' : slot.required ? '⚠' : '○'}
                </span>
                <span className="font-medium text-sm">{slot.label}</span>
                {slot.required && <span className="text-xs text-destructive">required</span>}
              </div>
              {slot.description && (
                <p className="text-xs text-muted-foreground mt-1">{slot.description}</p>
              )}
            </div>
            <div className="divide-y divide-border">
              {slot.options.map((opt) => {
                const pkg = packagesByName.get(opt);
                if (!pkg) {
                  // Option declared in template but package not installed locally.
                  return (
                    <div key={opt} className="px-4 py-3 text-sm">
                      <div className="font-medium">{opt}</div>
                      <div className="text-xs text-amber-600 dark:text-amber-400 mt-1">
                        Not installed — add to <code className="font-mono">amodal.json</code> packages.
                      </div>
                    </div>
                  );
                }
                return <PackageRow key={opt} pkg={pkg} />;
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Flat mode: one card per installed connection package
// ---------------------------------------------------------------------------

function FlatPackageList({ packages }: { packages: GettingStartedPackage[] }) {
  if (packages.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        This agent doesn&apos;t have any connection packages installed yet.
        Add packages to <code className="font-mono">amodal.json</code> to see them here.
      </p>
    );
  }
  return (
    <div className="space-y-2">
      {packages.map((pkg) => (
        <div key={pkg.name} className="rounded-lg border border-border bg-card">
          <PackageRow pkg={pkg} />
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Shared package row (used by both slot list and flat list)
// ---------------------------------------------------------------------------

function PackageRow({ pkg }: { pkg: GettingStartedPackage }) {
  const { runtimeUrl } = useStudioConfig();
  const [connecting, setConnecting] = useState(false);
  const [oauthError, setOauthError] = useState<string | null>(null);

  async function handleConnect() {
    if (!pkg.oauth?.available || connecting) return;
    setConnecting(true);
    setOauthError(null);
    try {
      const r = await fetch(`${runtimeUrl}/api/oauth/start?package=${encodeURIComponent(pkg.name)}`, {signal: AbortSignal.timeout(5_000)});
      if (!r.ok) {
        const text = await r.text().catch(() => '');
        throw new Error(`Runtime returned ${String(r.status)}${text ? ` — ${text}` : ''}`);
      }
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- system boundary
      const { authorizeUrl } = (await r.json()) as { authorizeUrl: string };
      window.location.href = authorizeUrl;
    } catch (err) {
      setOauthError(err instanceof Error ? err.message : String(err));
      setConnecting(false);
    }
  }

  return (
    <div className="px-4 py-3 space-y-2">
      <div className="flex items-center gap-3">
        {pkg.icon ? (
          <img src={pkg.icon} alt="" className="w-5 h-5 rounded shrink-0" />
        ) : (
          <span className="w-5 h-5" />
        )}
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium truncate">{pkg.displayName}</div>
          <div className="text-[11px] font-mono text-muted-foreground truncate">{pkg.name}</div>
        </div>
        {pkg.isFulfilled && (
          <span className="text-xs text-emerald-600 dark:text-emerald-400 mr-2">✓ Configured</span>
        )}
        {!pkg.isFulfilled && pkg.oauth?.available && (
          <button
            type="button"
            onClick={() => void handleConnect()}
            disabled={connecting}
            className="text-xs px-3 py-1 rounded bg-primary-solid text-white hover:opacity-90 disabled:opacity-50 mr-2"
          >
            {connecting ? 'Opening…' : `Connect ${pkg.oauth.appKey}`}
          </button>
        )}
        <Link
          to={`../connections/${encodeURIComponent(pkg.name)}`}
          className="text-xs text-primary hover:underline whitespace-nowrap"
        >
          Configure →
        </Link>
      </div>
      {oauthError && (
        <p className="text-[11px] text-destructive pl-8">OAuth start failed: {oauthError}</p>
      )}
      {pkg.envVars.length > 0 && (
        <ul className="space-y-1 pl-8">
          {pkg.envVars.map((v) => (
            <li key={v.name} className="flex items-center gap-2 text-[11px]">
              <span className={v.set ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400'}>
                {v.set ? '✓' : '○'}
              </span>
              <span className="font-mono text-foreground">{v.name}</span>
              <span className="text-muted-foreground truncate" title={v.description}>
                — {v.description}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * Reads `?connected=…` / `?error=…` from the URL — the runtime's OAuth
 * callback redirects here with those params on success/failure. Surfaces
 * the banner once and clears the params so a refresh doesn't repeat.
 */
function useOAuthCallbackBanner(): ReactNode {
  const [info, setInfo] = useState<{ kind: 'success' | 'error'; message: string } | null>(() => {
    const params = new URLSearchParams(window.location.search);
    const connected = params.get('connected');
    const errorParam = params.get('error');
    if (connected) return { kind: 'success', message: `Connected ${connected}.` };
    if (errorParam) return { kind: 'error', message: params.get('message') ?? errorParam };
    return null;
  });
  // Strip the params on first render so a refresh doesn't surface them again.
  if (info && typeof window !== 'undefined') {
    const params = new URLSearchParams(window.location.search);
    if (params.has('connected') || params.has('error') || params.has('message')) {
      params.delete('connected');
      params.delete('error');
      params.delete('message');
      const search = params.toString();
      const next = window.location.pathname + (search ? `?${search}` : '') + window.location.hash;
      window.history.replaceState({}, '', next);
    }
  }
  if (!info) return null;
  const cls =
    info.kind === 'success'
      ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400'
      : 'border-destructive/30 bg-destructive/5 text-destructive';
  return (
    <div className={`rounded-md border px-4 py-3 text-sm ${cls} flex items-center justify-between gap-3`}>
      <span>{info.message}</span>
      <button
        type="button"
        onClick={() => setInfo(null)}
        className="text-xs hover:underline"
      >
        Dismiss
      </button>
    </div>
  );
}
