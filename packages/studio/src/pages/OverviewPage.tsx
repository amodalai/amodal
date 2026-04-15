/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import { useMemo } from 'react';
import { AgentOffline } from '@/components/AgentOffline';
import { useRuntimeConfig } from '../hooks/useRuntimeConfig';

// ---------------------------------------------------------------------------
// Model pricing data (per 1M tokens)
// ---------------------------------------------------------------------------

const MODEL_META: Record<string, { input: number; output: number; cachedInput?: number; context: string }> = {
  'claude-opus-4-6':              { input: 15,    output: 75,   cachedInput: 1.50,  context: '1M' },
  'claude-sonnet-4-6':            { input: 3,     output: 15,   cachedInput: 0.30,  context: '1M' },
  'claude-haiku-4-5-20251001':    { input: 0.80,  output: 4,    cachedInput: 0.08,  context: '200K' },
  'gpt-4o':                       { input: 2.50,  output: 10,   context: '128K' },
  'gpt-4o-mini':                  { input: 0.15,  output: 0.60, context: '128K' },
  'gpt-4.1':                      { input: 2,     output: 8,    context: '1M' },
  'gpt-4.1-mini':                 { input: 0.40,  output: 1.60, context: '1M' },
  'gemini-3.1-pro-preview':        { input: 2,     output: 12,   context: '1M' },
  'gemini-3-pro-preview':          { input: 2,     output: 12,   context: '1M' },
  'gemini-3-flash-preview':        { input: 0.50,  output: 3,    context: '1M' },
  'gemini-3.1-flash-lite-preview': { input: 0.25,  output: 1.50, context: '1M' },
  'gemini-2.5-pro':               { input: 1.25,  output: 10,   context: '1M' },
  'gemini-2.5-flash':             { input: 0.15,  output: 0.60, context: '1M' },
  'deepseek-chat':                { input: 0.27,  output: 1.10, cachedInput: 0.07, context: '64K' },
  'deepseek-reasoner':            { input: 0.55,  output: 2.19, cachedInput: 0.14, context: '64K' },
  'llama-3.3-70b-versatile':      { input: 0.59,  output: 0.79, context: '128K' },
  'llama-3.1-8b-instant':         { input: 0.05,  output: 0.08, context: '128K' },
  'mistral-large-latest':          { input: 2,     output: 6,    context: '128K' },
  'mistral-small-latest':          { input: 0.10,  output: 0.30, context: '128K' },
  'codestral-latest':              { input: 0.30,  output: 0.90, context: '256K' },
  'grok-3':                        { input: 3,     output: 15,   context: '128K' },
  'grok-3-mini':                   { input: 0.30,  output: 0.50, context: '128K' },
};

const PROVIDER_COLORS: Record<string, {bg: string; text: string; dot: string}> = {
  anthropic: {bg: 'bg-amber-500/10', text: 'text-amber-600', dot: 'bg-amber-500'},
  openai:    {bg: 'bg-emerald-500/10', text: 'text-emerald-600', dot: 'bg-emerald-500'},
  google:    {bg: 'bg-blue-500/10', text: 'text-blue-600', dot: 'bg-blue-500'},
  deepseek:  {bg: 'bg-cyan-500/10', text: 'text-cyan-600', dot: 'bg-cyan-500'},
  groq:      {bg: 'bg-purple-500/10', text: 'text-purple-600', dot: 'bg-purple-500'},
  mistral:   {bg: 'bg-orange-500/10', text: 'text-orange-600', dot: 'bg-orange-500'},
  xai:       {bg: 'bg-rose-500/10', text: 'text-rose-600', dot: 'bg-rose-500'},
};

/** Maps a model name prefix to its provider key. */
const MODEL_PROVIDER_MAP: Record<string, string> = {
  claude: 'anthropic',
  gpt: 'openai',
  gemini: 'google',
  deepseek: 'deepseek',
  llama: 'groq',
  mistral: 'mistral',
  codestral: 'mistral',
  grok: 'xai',
};

function modelToProvider(modelName: string): string {
  for (const [prefix, provider] of Object.entries(MODEL_PROVIDER_MAP)) {
    if (modelName.startsWith(prefix)) return provider;
  }
  return 'unknown';
}

function formatPrice(price: number): string {
  return `$${price.toFixed(2)}`;
}

function priceColor(price: number): string {
  if (price <= 0.30) return 'text-emerald-500';
  if (price <= 3) return 'text-foreground';
  if (price <= 10) return 'text-amber-500';
  return 'text-red-400';
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function StatusBadge({ verified, keySet }: { verified: boolean; keySet: boolean }) {
  const isOk = verified && keySet;
  const label = verified ? 'verified' : keySet ? 'key set' : 'missing';
  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${
        isOk ? 'bg-emerald-500/10 text-emerald-600' : 'bg-red-500/10 text-red-600'
      }`}
    >
      <span className={`w-1.5 h-1.5 rounded-full ${isOk ? 'bg-emerald-500' : 'bg-red-500'}`} />
      {label}
    </span>
  );
}

function ProviderStatusBadge({ provider, providerStatuses }: {
  provider: string;
  providerStatuses: Array<{ provider: string; keySet: boolean; verified: boolean }>;
}) {
  const ps = providerStatuses.find((s) => s.provider === provider);
  if (!ps) {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-muted text-muted-foreground">
        <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground/40" />
        No API key
      </span>
    );
  }
  if (ps.verified) {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-500/10 text-emerald-600">
        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
        Verified
      </span>
    );
  }
  if (ps.keySet) {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-red-500/10 text-red-600">
        <span className="w-1.5 h-1.5 rounded-full bg-red-500" />
        Key invalid
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-muted text-muted-foreground">
      <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground/40" />
      No API key
    </span>
  );
}

function formatUptime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

// ---------------------------------------------------------------------------
// Pricing table types
// ---------------------------------------------------------------------------

interface ProviderGroup {
  provider: string;
  configured: boolean;
  models: Array<{ name: string; meta: { input: number; output: number; cachedInput?: number; context: string } }>;
}

function useProviderGroups(
  providerStatuses: Array<{ provider: string; keySet: boolean; verified: boolean }> | undefined,
): ProviderGroup[] {
  return useMemo(() => {
    const configuredProviders = new Set(
      (providerStatuses ?? []).filter((s) => s.keySet).map((s) => s.provider),
    );

    const grouped = new Map<string, ProviderGroup>();
    for (const [modelName, meta] of Object.entries(MODEL_META)) {
      const provider = modelToProvider(modelName);
      let group = grouped.get(provider);
      if (!group) {
        group = { provider, configured: configuredProviders.has(provider), models: [] };
        grouped.set(provider, group);
      }
      group.models.push({ name: modelName, meta });
    }

    // Configured providers first, then alphabetical
    return Array.from(grouped.values()).sort((a, b) => {
      if (a.configured !== b.configured) return a.configured ? -1 : 1;
      return a.provider.localeCompare(b.provider);
    });
  }, [providerStatuses]);
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export function OverviewPage() {
  const { config, error, loading } = useRuntimeConfig();
  const providerGroups = useProviderGroups(config?.providerStatuses);

  if (error) return <AgentOffline page="overview" detail={error} />;
  if (loading || !config) return null;

  const modelEntries = config.models ? Object.entries(config.models) : [];

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold text-foreground">Overview</h1>

      {/* Identity card */}
      <div className="bg-card border border-border rounded-lg p-4">
        <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wide">
          Agent
        </h2>
        <p className="mt-1 text-lg font-semibold text-foreground">{config.name}</p>
        {config.version && (
          <p className="mt-0.5 text-sm text-muted-foreground">v{config.version}</p>
        )}
        {config.description && (
          <p className="mt-2 text-sm text-muted-foreground">{config.description}</p>
        )}
      </div>

      {/* Configured Models */}
      {modelEntries.length > 0 && (
        <div className="bg-card border border-border rounded-lg p-4">
          <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wide mb-3">
            Configured Models
          </h2>
          <div className="space-y-2">
            {modelEntries.map(([purpose, m]) => {
              const meta = MODEL_META[m.model];
              const colors = PROVIDER_COLORS[m.provider];
              return (
                <div key={purpose} className="flex items-center justify-between text-sm">
                  <div className="flex items-center gap-2">
                    {colors && (
                      <span className={`w-2 h-2 rounded-full ${colors.dot}`} />
                    )}
                    <span className="text-foreground font-medium">{m.model}</span>
                    {meta && (
                      <span className="text-xs text-muted-foreground">
                        {meta.context} ctx
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    {meta && (
                      <span className={`text-xs font-mono ${priceColor(meta.input)}`}>
                        {formatPrice(meta.input)}/{formatPrice(meta.output)}
                      </span>
                    )}
                    <span className="text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded">
                      {purpose}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Providers */}
      {config.providerStatuses && config.providerStatuses.length > 0 && (
        <div className="bg-card border border-border rounded-lg p-4">
          <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wide mb-3">
            Providers
          </h2>
          <div className="space-y-2">
            {config.providerStatuses.map((ps) => (
              <div key={ps.provider} className="flex items-center justify-between text-sm">
                <span className="text-foreground">{ps.provider}</span>
                <StatusBadge verified={ps.verified} keySet={ps.keySet} />
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Model Catalog / Pricing Table */}
      <div className="bg-card border border-border rounded-lg p-4">
        <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wide mb-4">
          Model Catalog &mdash; Pricing per 1M tokens
        </h2>
        <div className="space-y-5">
          {providerGroups.map((group) => {
            const colors = PROVIDER_COLORS[group.provider] ?? {
              bg: 'bg-muted', text: 'text-muted-foreground', dot: 'bg-muted-foreground/40',
            };
            return (
              <div
                key={group.provider}
                className={!group.configured ? 'opacity-50' : undefined}
              >
                {/* Provider header */}
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <span className={`w-2.5 h-2.5 rounded-full ${colors.dot}`} />
                    <span className={`text-sm font-semibold capitalize ${colors.text}`}>
                      {group.provider}
                    </span>
                  </div>
                  <ProviderStatusBadge
                    provider={group.provider}
                    providerStatuses={config.providerStatuses ?? []}
                  />
                </div>

                {/* Models table */}
                <div className="ml-5 border border-border rounded overflow-hidden">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-muted text-muted-foreground text-xs uppercase">
                        <th className="text-left px-3 py-1.5 font-medium">Model</th>
                        <th className="text-right px-3 py-1.5 font-medium">Input</th>
                        <th className="text-right px-3 py-1.5 font-medium">Output</th>
                        <th className="text-right px-3 py-1.5 font-medium">Cached</th>
                        <th className="text-right px-3 py-1.5 font-medium">Context</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {group.models.map((m) => (
                        <tr key={m.name} className="hover:bg-muted/50">
                          <td className="px-3 py-1.5 text-foreground font-mono text-xs">
                            {m.name}
                          </td>
                          <td className={`px-3 py-1.5 text-right font-mono text-xs ${priceColor(m.meta.input)}`}>
                            {formatPrice(m.meta.input)}
                          </td>
                          <td className={`px-3 py-1.5 text-right font-mono text-xs ${priceColor(m.meta.output)}`}>
                            {formatPrice(m.meta.output)}
                          </td>
                          <td className="px-3 py-1.5 text-right font-mono text-xs text-muted-foreground">
                            {m.meta.cachedInput != null ? formatPrice(m.meta.cachedInput) : '\u2014'}
                          </td>
                          <td className="px-3 py-1.5 text-right text-xs text-muted-foreground">
                            {m.meta.context}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Runtime info */}
      {(config.runtimeVersion ?? config.nodeVersion ?? config.uptime) != null && (
        <div className="bg-card border border-border rounded-lg p-4">
          <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wide mb-3">
            Runtime
          </h2>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
            {config.runtimeVersion && (
              <>
                <dt className="text-muted-foreground">Version</dt>
                <dd className="text-foreground">{config.runtimeVersion}</dd>
              </>
            )}
            {config.nodeVersion && (
              <>
                <dt className="text-muted-foreground">Node.js</dt>
                <dd className="text-foreground">{config.nodeVersion}</dd>
              </>
            )}
            {config.uptime != null && (
              <>
                <dt className="text-muted-foreground">Uptime</dt>
                <dd className="text-foreground">{formatUptime(config.uptime)}</dd>
              </>
            )}
          </dl>
        </div>
      )}
    </div>
  );
}
