/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import {useEffect, useState} from 'react';
import {ArrowUpDown, Check, Copy, KeyRound, Save, SlidersHorizontal} from 'lucide-react';
import { AgentOffline } from '@/components/AgentOffline';
import {useModelCatalog} from '@/hooks/useModelCatalog';
import {useSessionHistory} from '@/hooks/useSessionHistory';
import {buildModelConfigSnippet, type ModelCatalogEntry} from '@/lib/model-catalog';
import {groupSessions, summarizeCost} from '@/lib/cost-analytics';
import {PROVIDER_COLORS, formatPrice} from '@/lib/model-pricing';

type ModelFilter = 'all' | 'configured' | 'available';
type SortKey = 'model' | 'input' | 'output' | 'context' | 'usage' | 'status';
type SortDirection = 'asc' | 'desc';

function microsPerMillionToDollars(micros: number): string {
  return formatPrice(micros / 1_000_000);
}

function providerLabel(provider: string): string {
  return provider.charAt(0).toUpperCase() + provider.slice(1);
}

function modelStatus(model: ModelCatalogEntry): string {
  if (model.isCurrent) return 'Current';
  if (model.configuredAliases.length > 0) return 'Configured';
  if (model.verified) return 'Available';
  if (model.keySet) return 'Key issue';
  return 'Needs key';
}

function statusClass(model: ModelCatalogEntry): string {
  if (model.isCurrent) return 'bg-primary/10 text-primary';
  if (model.verified) return 'bg-emerald-500/10 text-emerald-600';
  if (model.keySet) return 'bg-amber-500/10 text-amber-600';
  return 'bg-muted text-muted-foreground';
}

function providerTone(provider: string): {bg: string; text: string; dot: string} {
  return PROVIDER_COLORS[provider] ?? {bg: 'bg-muted', text: 'text-muted-foreground', dot: 'bg-muted-foreground'};
}

function formatContext(context: string): string {
  return context === 'unknown' ? '—' : context;
}

function contextSortValue(context: string): number | null {
  if (context === 'unknown') return null;
  const parsed = Number.parseInt(context.replace(/\D/g, ''), 10);
  if (!Number.isFinite(parsed)) return null;
  return context.toUpperCase().includes('M') ? parsed * 1000 : parsed;
}

function modelMatchesFilter(model: ModelCatalogEntry, filter: ModelFilter): boolean {
  switch (filter) {
    case 'all':
      return true;
    case 'configured':
      return model.configuredAliases.length > 0;
    case 'available':
      return model.verified;
    default: {
      const _exhaustive: never = filter;
      return _exhaustive;
    }
  }
}

function sortValue(model: ModelCatalogEntry, usageMap: Map<string, {totalTokens: number}>, key: SortKey): string | number {
  switch (key) {
    case 'model':
      return `${model.provider}/${model.label}/${model.model}`;
    case 'input':
      return model.inputPerMToken;
    case 'output':
      return model.outputPerMToken;
    case 'context':
      return contextSortValue(model.context) ?? 0;
    case 'usage':
      return usageMap.get(model.model)?.totalTokens ?? 0;
    case 'status':
      return modelStatus(model);
    default: {
      const _exhaustive: never = key;
      return _exhaustive;
    }
  }
}

function compareSortValues(a: string | number, b: string | number): number {
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  return String(a).localeCompare(String(b));
}

function compareModels(
  a: ModelCatalogEntry,
  b: ModelCatalogEntry,
  usageMap: Map<string, {totalTokens: number}>,
  key: SortKey,
  direction: SortDirection,
): number {
  if (key === 'context') {
    const aContext = contextSortValue(a.context);
    const bContext = contextSortValue(b.context);
    if (aContext === null && bContext !== null) return 1;
    if (aContext !== null && bContext === null) return -1;
  }

  const result = compareSortValues(sortValue(a, usageMap, key), sortValue(b, usageMap, key));
  return direction === 'asc' ? result : -result;
}

function SortHeader({
  label,
  sortKey,
  activeKey,
  direction,
  onSort,
}: {
  label: string;
  sortKey: SortKey;
  activeKey: SortKey;
  direction: SortDirection;
  onSort: (key: SortKey) => void;
}) {
  const active = sortKey === activeKey;
  return (
    <button
      type="button"
      onClick={() => onSort(sortKey)}
      className={`inline-flex items-center gap-1 text-left font-medium ${active ? 'text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
    >
      {label}
      <ArrowUpDown className={`h-3 w-3 ${active && direction === 'desc' ? 'rotate-180' : ''}`} />
    </button>
  );
}

export function ModelsPage() {
  const {catalog, error, saveError, loading, saving, saveMainModel} = useModelCatalog();
  const {sessions, error: sessionsError} = useSessionHistory();
  const [filter, setFilter] = useState<ModelFilter>('all');
  const [sortKey, setSortKey] = useState<SortKey>('status');
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc');
  const [selectedModel, setSelectedModel] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [saved, setSaved] = useState(false);
  const currentModelKey = catalog?.currentModel?.model ?? null;

  useEffect(() => {
    if (!selectedModel && currentModelKey) setSelectedModel(currentModelKey);
  }, [currentModelKey, selectedModel]);

  if (error) return <AgentOffline page="models" detail={error} />;
  if (loading || !catalog) return null;

  const selected = catalog.models.find((model) => model.model === (selectedModel ?? currentModelKey))
    ?? catalog.models[0]
    ?? null;
  const summary = sessions ? summarizeCost(sessions) : null;
  const usageByModel = sessions
    ? groupSessions(
      sessions,
      (session) => session.model ?? 'unknown',
      (session) => session.model ?? 'Unknown model',
    )
    : [];
  const usageMap = new Map(usageByModel.map((usage) => [usage.key, usage]));
  const filteredModels = catalog.models
    .filter((model) => modelMatchesFilter(model, filter))
    .sort((a, b) => compareModels(a, b, usageMap, sortKey, sortDirection));
  const configuredAliases = catalog.configuredModels.map((entry) => entry.alias).join(', ');
  const providerCount = new Set(catalog.models.filter((model) => model.verified).map((model) => model.provider)).size;
  const snippet = selected ? buildModelConfigSnippet(selected) : '';
  const providerStatuses = catalog.providerStatuses;

  const copySnippet = async () => {
    await navigator.clipboard.writeText(snippet);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  };

  const updateSort = (key: SortKey) => {
    if (key === sortKey) {
      setSortDirection((direction) => direction === 'asc' ? 'desc' : 'asc');
      return;
    }
    setSortKey(key);
    setSortDirection(key === 'status' || key === 'model' ? 'asc' : 'desc');
  };

  const saveSelectedModel = async () => {
    if (!selected || selected.isCurrent || !selected.verified) return;
    try {
      const response = await saveMainModel({provider: selected.provider, model: selected.model});
      setSelectedModel(response.currentModel?.model ?? selected.model);
      setSaved(true);
      window.setTimeout(() => setSaved(false), 2000);
    } catch {
      setSaved(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-foreground">Models</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Review the agent model, provider keys, pricing, and config snippets. Studio does not route separate skills to separate models.
          </p>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <div className="rounded-lg border border-border bg-card p-4">
          <div className="text-xs font-medium uppercase text-muted-foreground">Current model</div>
          <div className="mt-2 truncate text-lg font-semibold text-foreground">
            {catalog.currentModel?.model ?? 'Not configured'}
          </div>
          <div className="mt-1 text-sm text-muted-foreground">
            {catalog.currentModel ? `${providerLabel(catalog.currentModel.provider)} · models.main` : 'Set models.main in amodal.json'}
          </div>
        </div>
        <div className="rounded-lg border border-border bg-card p-4">
          <div className="text-xs font-medium uppercase text-muted-foreground">Available providers</div>
          <div className="mt-2 text-lg font-semibold text-foreground">{String(providerCount)}</div>
          <div className="mt-1 text-sm text-muted-foreground">
            {providerStatuses.length > 0 ? `${String(providerStatuses.filter((provider) => provider.verified).length)}/${String(providerStatuses.length)} verified` : 'No provider keys reported'}
          </div>
        </div>
        <div className="rounded-lg border border-border bg-card p-4">
          <div className="text-xs font-medium uppercase text-muted-foreground">Recent usage</div>
          <div className="mt-2 text-lg font-semibold text-foreground">
            {summary ? formatPrice(summary.totalCost) : '—'}
          </div>
          <div className="mt-1 text-sm text-muted-foreground">
            {summary ? `${summary.totalTokens.toLocaleString()} tokens across ${String(summary.knownCostSessions)} priced sessions` : sessionsError ?? 'No sessions loaded'}
          </div>
        </div>
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="min-w-0 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold text-foreground">Model catalog</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Showing canonical pricing from core model metadata and credential status from the runtime.
              </p>
            </div>
            <div className="inline-flex rounded-md border border-border bg-card p-1">
              {(['all', 'configured', 'available'] as const).map((nextFilter) => (
                <button
                  key={nextFilter}
                  type="button"
                  onClick={() => setFilter(nextFilter)}
                  className={`rounded px-2.5 py-1 text-xs font-medium ${filter === nextFilter ? 'bg-muted text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
                >
                  {nextFilter}
                </button>
              ))}
            </div>
          </div>

          <div className="overflow-hidden rounded-lg border border-border bg-card">
            <table className="w-full table-fixed text-sm">
              <colgroup>
                <col className="w-[36%]" />
                <col className="w-[12%]" />
                <col className="w-[12%]" />
                <col className="w-[11%]" />
                <col className="w-[17%]" />
                <col className="w-[12%]" />
              </colgroup>
              <thead>
                <tr className="border-b border-border bg-muted/40">
                  <th className="px-3 py-2 text-left"><SortHeader label="Model" sortKey="model" activeKey={sortKey} direction={sortDirection} onSort={updateSort} /></th>
                  <th className="px-3 py-2 text-left"><SortHeader label="Input" sortKey="input" activeKey={sortKey} direction={sortDirection} onSort={updateSort} /></th>
                  <th className="px-3 py-2 text-left"><SortHeader label="Output" sortKey="output" activeKey={sortKey} direction={sortDirection} onSort={updateSort} /></th>
                  <th className="px-3 py-2 text-left"><SortHeader label="Context" sortKey="context" activeKey={sortKey} direction={sortDirection} onSort={updateSort} /></th>
                  <th className="px-3 py-2 text-left"><SortHeader label="Usage" sortKey="usage" activeKey={sortKey} direction={sortDirection} onSort={updateSort} /></th>
                  <th className="px-3 py-2 text-left"><SortHeader label="Status" sortKey="status" activeKey={sortKey} direction={sortDirection} onSort={updateSort} /></th>
                </tr>
              </thead>
              <tbody>
                {filteredModels.map((model) => {
                  const usage = usageMap.get(model.model);
                  const tone = providerTone(model.provider);
                  return (
                    <tr
                      key={model.model}
                      className={`border-b border-border last:border-0 hover:bg-muted/40 ${selected?.model === model.model ? 'bg-muted/50' : ''}`}
                    >
                      <td className="px-3 py-3">
                        <button
                          type="button"
                          onClick={() => {
                            setCopied(false);
                            setSelectedModel(model.model);
                          }}
                          className="block w-full text-left"
                        >
                          <span className="flex min-w-0 items-center gap-2">
                            <span className={`h-2 w-2 rounded-full ${tone.dot}`} />
                            <span className="truncate font-medium text-foreground">{model.label}</span>
                          </span>
                          <span className="mt-0.5 block truncate font-mono text-xs text-muted-foreground">{model.model}</span>
                          <span className={`mt-1 inline-flex rounded px-1.5 py-0.5 text-xs ${tone.bg} ${tone.text}`}>{providerLabel(model.provider)}</span>
                        </button>
                      </td>
                      <td className="px-3 py-3 font-mono text-xs text-foreground">{microsPerMillionToDollars(model.inputPerMToken)}/M</td>
                      <td className="px-3 py-3 font-mono text-xs text-foreground">{microsPerMillionToDollars(model.outputPerMToken)}/M</td>
                      <td className="px-3 py-3 text-muted-foreground">{formatContext(model.context)}</td>
                      <td className="px-3 py-3 text-muted-foreground">
                        {usage ? `${usage.totalTokens.toLocaleString()} tokens` : '—'}
                      </td>
                      <td className="px-3 py-3">
                        <span className={`inline-flex rounded px-2 py-1 text-xs font-medium ${statusClass(model)}`}>
                          {modelStatus(model)}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        <aside className="min-w-0 space-y-4">
          <div className="rounded-lg border border-border bg-card p-4">
            <div className="flex items-center gap-2">
              <SlidersHorizontal className="h-4 w-4 text-muted-foreground" />
              <h2 className="text-sm font-semibold text-foreground">Selected config</h2>
            </div>
            {selected ? (
              <div className="mt-4 space-y-4">
                <div>
                  <div className="text-sm font-medium text-foreground">{selected.label}</div>
                  <div className="mt-1 font-mono text-xs text-muted-foreground">{selected.provider}/{selected.model}</div>
                  <div className="mt-2 text-sm text-muted-foreground">
                    {selected.configuredAliases.length > 0 ? `Configured as ${selected.configuredAliases.join(', ')}` : 'Not currently configured'}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => { void copySnippet(); }}
                  className="inline-flex items-center gap-2 rounded-md border border-border px-3 py-1.5 text-sm text-foreground hover:bg-muted"
                >
                  {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                  {copied ? 'Copied' : 'Copy snippet'}
                </button>
                <button
                  type="button"
                  onClick={() => { void saveSelectedModel(); }}
                  disabled={saving || selected.isCurrent || !selected.verified}
                  className="inline-flex items-center gap-2 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <Save className="h-4 w-4" />
                  {saving ? 'Saving...' : selected.isCurrent ? 'Current model' : selected.verified ? 'Use this model' : 'Provider key required'}
                </button>
                {saved && <p className="text-sm text-muted-foreground">Saved as an <code className="font-mono">amodal.json</code> draft.</p>}
                {saveError && <p className="text-sm text-destructive">{saveError}</p>}
                <pre className="overflow-auto rounded-md border border-border bg-muted p-3 text-xs text-foreground">
                  <code>{snippet}</code>
                </pre>
              </div>
            ) : (
              <p className="mt-3 text-sm text-muted-foreground">No model metadata available.</p>
            )}
          </div>

          <div className="rounded-lg border border-border bg-card p-4">
            <div className="flex items-center gap-2">
              <KeyRound className="h-4 w-4 text-muted-foreground" />
              <h2 className="text-sm font-semibold text-foreground">Provider keys</h2>
            </div>
            <div className="mt-3 space-y-2">
              {providerStatuses.length === 0 ? (
                <p className="text-sm text-muted-foreground">No provider status reported by runtime.</p>
              ) : providerStatuses.map((provider) => (
                <div key={provider.provider} className="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2 text-sm">
                  <div>
                    <div className="font-medium text-foreground">{providerLabel(provider.provider)}</div>
                    <div className="font-mono text-xs text-muted-foreground">{provider.envVar}</div>
                  </div>
                  <span className={`rounded px-2 py-1 text-xs font-medium ${provider.verified ? 'bg-emerald-500/10 text-emerald-600' : provider.keySet ? 'bg-amber-500/10 text-amber-600' : 'bg-muted text-muted-foreground'}`}>
                    {provider.verified ? 'Verified' : provider.keySet ? 'Key issue' : 'Missing'}
                  </span>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-lg border border-border bg-card p-4">
            <h2 className="text-sm font-semibold text-foreground">Runtime behavior</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              Normal chat sessions use <code className="font-mono">models.main</code>. Skills, knowledge, and connection context are loaded into that same run.
            </p>
            {configuredAliases && (
              <p className="mt-2 text-sm text-muted-foreground">
                Configured aliases: <span className="font-mono">{configuredAliases}</span>
              </p>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}
