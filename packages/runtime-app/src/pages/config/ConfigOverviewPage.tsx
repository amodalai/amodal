/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import { useEffect, useState } from 'react';
import { Cpu, Server, Check, AlertTriangle } from 'lucide-react';

interface ModelConfig {
  provider: string;
  model: string;
}

interface ArenaModel {
  provider: string;
  model: string;
  label?: string;
}

interface ProviderStatus {
  provider: string;
  envVar: string;
  keySet: boolean;
  verified: boolean;
  error?: string;
}

interface ConfigData {
  name: string;
  version: string;
  description: string;
  models: Record<string, ModelConfig>;
  repoPath: string;
  nodeVersion: string;
  runtimeVersion: string;
  uptime: number;
  stores: { dataDir?: string; backend?: string } | null;
  providerStatuses?: ProviderStatus[];
}

// Pricing per 1M tokens (input / output) and context window
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


function formatUptime(seconds: number): string {
  if (seconds < 60) return `${String(seconds)}s`;
  const mins = Math.floor(seconds / 60);
  if (mins < 60) return `${String(mins)}m ${String(seconds % 60)}s`;
  const hours = Math.floor(mins / 60);
  return `${String(hours)}h ${String(mins % 60)}m`;
}

const PROVIDER_COLORS: Record<string, {bg: string; text: string; dot: string}> = {
  anthropic: {bg: 'bg-amber-500/10', text: 'text-amber-600 dark:text-amber-400', dot: 'bg-amber-500'},
  openai:    {bg: 'bg-emerald-500/10', text: 'text-emerald-600 dark:text-emerald-400', dot: 'bg-emerald-500'},
  google:    {bg: 'bg-blue-500/10', text: 'text-blue-600 dark:text-blue-400', dot: 'bg-blue-500'},
  deepseek:  {bg: 'bg-cyan-500/10', text: 'text-cyan-600 dark:text-cyan-400', dot: 'bg-cyan-500'},
  groq:      {bg: 'bg-purple-500/10', text: 'text-purple-600 dark:text-purple-400', dot: 'bg-purple-500'},
  mistral:   {bg: 'bg-orange-500/10', text: 'text-orange-600 dark:text-orange-400', dot: 'bg-orange-500'},
  xai:       {bg: 'bg-rose-500/10', text: 'text-rose-600 dark:text-rose-400', dot: 'bg-rose-500'},
};

function formatPrice(price: number): string {
  return `$${price.toFixed(2)}`;
}

function priceColor(price: number): string {
  if (price <= 0.30) return 'text-emerald-500';
  if (price <= 3) return 'text-foreground';
  if (price <= 10) return 'text-amber-500';
  return 'text-red-400';
}

export function ConfigOverviewPage() {
  const [data, setData] = useState<ConfigData | null>(null);
  const [arenaModels, setArenaModels] = useState<ArenaModel[]>([]);

  useEffect(() => {
    fetch('/api/config')
      .then((res) => (res.ok ? res.json() : null))
      .then((d: unknown) => {
        if (d) {
          // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- Server response
          setData(d as ConfigData);
        }
      })
      .catch(() => {});

    fetch('/api/evals/arena/models')
      .then((res) => (res.ok ? res.json() : null))
      .then((d: unknown) => {
        if (d && typeof d === 'object' && 'models' in d) {
          // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- Server response
          setArenaModels((d as { models: ArenaModel[] }).models);
        }
      })
      .catch(() => {});
  }, []);

  if (!data) return <div className="p-8 text-muted-foreground text-sm">Loading...</div>;

  const mainModel = data.models['main'];
  const otherModels = Object.entries(data.models).filter(([key]) => key !== 'main');

  // Provider verification status
  const providerStatusMap = new Map(
    (data.providerStatuses ?? []).map((s) => [s.provider, s]),
  );

  // Group arena models by provider
  const providers = [...new Set(arenaModels.map((m) => m.provider))];

  return (
    <div className="p-8 max-w-3xl">
      {/* Agent identity */}
      <div className="mb-8">
        <div className="flex items-baseline gap-2">
          <h1 className="text-lg font-semibold text-foreground">{data.name || 'Agent'}</h1>
          {data.version && <span className="text-xs text-muted-foreground font-mono">v{data.version}</span>}
        </div>
        {data.description && (
          <p className="text-sm text-muted-foreground mt-1">{data.description}</p>
        )}
        <div className="text-xs text-muted-foreground font-mono mt-2">{data.repoPath}</div>
      </div>

      {/* Configured models */}
      <div className="mb-8">
        <h2 className="text-sm font-semibold text-foreground mb-3">Configured Models</h2>
        <div className="space-y-2">
          {mainModel && (
            <div className="border border-border rounded-lg p-4 bg-card">
              <div className="flex items-center gap-3">
                <Cpu className="h-4 w-4 text-primary shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-foreground">{mainModel.model.replace(/-\d{8}$/, '')}</span>
                    <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-primary/10 text-primary font-medium">main</span>
                  </div>
                  <div className="text-xs text-muted-foreground mt-0.5">{mainModel.provider}</div>
                </div>
              </div>
            </div>
          )}
          {otherModels.map(([key, m]) => (
            <div key={key} className="flex items-center gap-3 border border-border rounded-lg px-4 py-3 bg-card">
              <Cpu className="h-4 w-4 text-muted-foreground shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm text-foreground">{m.model.replace(/-\d{8}$/, '')}</span>
                  <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground font-medium">{key}</span>
                </div>
                <div className="text-xs text-muted-foreground mt-0.5">{m.provider}</div>
              </div>
            </div>
          ))}
          {!mainModel && otherModels.length === 0 && (
            <div className="text-sm text-muted-foreground">No models configured.</div>
          )}
        </div>
      </div>

      {/* Runtime */}
      <div className="mb-8">
        <h2 className="text-sm font-semibold text-foreground mb-3">Runtime</h2>
        <div className="grid grid-cols-2 gap-2">
          <InfoCell icon={<Server className="h-3.5 w-3.5" />} label="Version" value={data.runtimeVersion} />
          <InfoCell icon={<Server className="h-3.5 w-3.5" />} label="Node.js" value={data.nodeVersion} />
          <InfoCell icon={<Server className="h-3.5 w-3.5" />} label="Uptime" value={formatUptime(data.uptime)} />
          {data.stores && (
            <InfoCell icon={<Server className="h-3.5 w-3.5" />} label="Store" value={data.stores.backend ?? 'pglite'} />
          )}
        </div>
      </div>

      {/* Available models catalog */}
      {arenaModels.length > 0 && (() => (
          <div className="mb-8">
            <h2 className="text-sm font-semibold text-foreground mb-1">Available Models</h2>
            <p className="text-xs text-muted-foreground mb-3">Pricing per 1M tokens.</p>

            <div className="space-y-3">
              {providers.map((provider) => {
                const providerModels = arenaModels.filter((m) => m.provider === provider);
                const status = providerStatusMap.get(provider);
                const colors = PROVIDER_COLORS[provider] ?? {bg: 'bg-muted', text: 'text-muted-foreground', dot: 'bg-gray-400'};

                const isConfigured = status?.keySet;

                return (
                  <div key={provider} className={`border border-border rounded-lg overflow-hidden ${!isConfigured ? 'opacity-50' : ''}`}>
                    {/* Provider header */}
                    <div className={`flex items-center justify-between px-3 py-2 ${isConfigured ? colors.bg : 'bg-muted/30'}`}>
                      <div className="flex items-center gap-2">
                        <div className={`w-2 h-2 rounded-full ${isConfigured ? colors.dot : 'bg-gray-400'}`} />
                        <span className={`text-xs font-semibold ${isConfigured ? colors.text : 'text-muted-foreground'}`}>
                          {provider.charAt(0).toUpperCase() + provider.slice(1)}
                        </span>
                      </div>
                      {status?.verified ? (
                        <div className="flex items-center gap-1">
                          <Check className="h-3 w-3 text-emerald-500" />
                          <span className="text-[10px] text-emerald-600 dark:text-emerald-400 font-medium">Verified</span>
                        </div>
                      ) : status?.keySet ? (
                        <div className="flex items-center gap-1" title={status.error}>
                          <AlertTriangle className="h-3 w-3 text-amber-500" />
                          <span className="text-[10px] text-amber-600 dark:text-amber-400 font-medium">Key invalid</span>
                        </div>
                      ) : (
                        <span className="text-[10px] text-muted-foreground">No API key</span>
                      )}
                    </div>
                    {/* Model rows */}
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="border-b border-border bg-muted/30">
                          <th className="text-left px-3 py-1.5 font-medium text-muted-foreground">Model</th>
                          <th className="text-right px-3 py-1.5 font-medium text-muted-foreground">Context</th>
                          <th className="text-right px-3 py-1.5 font-medium text-muted-foreground">Input</th>
                          <th className="text-right px-3 py-1.5 font-medium text-muted-foreground">Cached</th>
                          <th className="text-right px-3 py-1.5 font-medium text-muted-foreground">Output</th>
                        </tr>
                      </thead>
                      <tbody>
                        {providerModels.map((m, i) => {
                          const meta = MODEL_META[m.model];
                          return (
                            <tr key={m.model} className={i < providerModels.length - 1 ? 'border-b border-border/50' : ''}>
                              <td className="px-3 py-2 text-foreground font-medium">{m.label ?? m.model}</td>
                              <td className="text-right px-3 py-2 text-muted-foreground tabular-nums">{meta?.context ?? '—'}</td>
                              <td className={`text-right px-3 py-2 tabular-nums ${meta ? priceColor(meta.input) : 'text-muted-foreground'}`}>
                                {meta ? formatPrice(meta.input) : '—'}
                              </td>
                              <td className={`text-right px-3 py-2 tabular-nums ${meta?.cachedInput ? priceColor(meta.cachedInput) : 'text-muted-foreground'}`}>
                                {meta?.cachedInput ? formatPrice(meta.cachedInput) : '—'}
                              </td>
                              <td className={`text-right px-3 py-2 tabular-nums ${meta ? priceColor(meta.output) : 'text-muted-foreground'}`}>
                                {meta ? formatPrice(meta.output) : '—'}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                );
              })}
            </div>
          </div>
        ))()}

    </div>
  );
}

function InfoCell({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="flex items-center gap-2.5 border border-border rounded-lg px-3 py-2.5 bg-card">
      <span className="text-muted-foreground">{icon}</span>
      <div>
        <div className="text-[10px] text-muted-foreground">{label}</div>
        <div className="text-xs text-foreground font-medium">{value}</div>
      </div>
    </div>
  );
}
