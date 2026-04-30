/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { FileText } from 'lucide-react';
import { runtimeApiUrl } from '@/lib/api';
import { AgentOffline } from '@/components/AgentOffline';

interface Contribution {
  name: string;
  category: string;
  tokens: number;
  filePath?: string;
}

interface PromptData {
  system_prompt: string;
  system_prompt_length: number;
  model: string;
  token_usage: {
    total: number;
    used: number;
    remaining: number;
    sectionBreakdown: Record<string, number>;
  };
  contributions: Contribution[];
}

/** Tailwind bg classes for prompt category colors (semantic status colors per CLAUDE.md). */
const CATEGORY_BG: Record<string, string> = {
  connection: 'bg-emerald-500',
  knowledge: 'bg-blue-500',
  skill: 'bg-amber-500',
  system: 'bg-muted-foreground/50',
};
const DEFAULT_CATEGORY_BG = 'bg-muted-foreground/30';

function categoryLabel(cat: string): string {
  return cat.charAt(0).toUpperCase() + cat.slice(1);
}

export function PromptPage() {
  const [data, setData] = useState<PromptData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showPrompt, setShowPrompt] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    fetch(runtimeApiUrl('/inspect/context'), { signal: AbortSignal.timeout(5_000) })
      .then((res) => {
        if (!res.ok) throw new Error(`Request failed: ${String(res.status)}`);
        // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- system boundary: parsing JSON response
        return res.json() as Promise<PromptData>;
      })
      .then(setData)
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));
  }, []);

  if (error) return <AgentOffline page="prompt" detail={error} />;
  if (!data) return null;

  // Aggregate by category
  const categoryTotals = new Map<string, number>();
  for (const c of data.contributions) {
    categoryTotals.set(c.category, (categoryTotals.get(c.category) ?? 0) + c.tokens);
  }
  const categoryData = [...categoryTotals.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([cat, tokens]) => ({ name: categoryLabel(cat), category: cat, value: tokens }));

  // Top 10 individual items sorted by tokens
  const top10 = [...data.contributions]
    .filter((c) => c.tokens > 0)
    .sort((a, b) => b.tokens - a.tokens)
    .slice(0, 10);

  const promptTokens = data.token_usage.used;
  const contextWindow = data.token_usage.total;
  const promptPct = contextWindow > 0 ? (promptTokens / contextWindow) * 100 : 0;

  return (
    <div className="p-8 max-w-2xl">
      <h1 className="text-lg font-semibold text-foreground mb-1">System Prompt</h1>
      <p className="text-sm text-muted-foreground mb-6">
        Compiled prompt sent at session start.
        {data.model && <span className="ml-1 text-xs opacity-60">({data.model})</span>}
      </p>

      {/* Summary + stacked bar (full context width) */}
      <div className="mb-6">
        <div className="text-sm text-foreground font-medium mb-1">
          {promptTokens.toLocaleString()} prompt tokens
        </div>
        <div className="text-xs text-muted-foreground mb-3">
          {contextWindow >= 1_000_000
            ? `${(contextWindow / 1_000_000).toFixed(0)}M`
            : `${(contextWindow / 1000).toFixed(0)}K`} context window — {promptPct < 1 ? '<1' : Math.round(promptPct)}% used by prompt
        </div>

        {/* Stacked bar — prompt categories as proportion of full context window */}
        <div className="h-3 bg-muted rounded-full overflow-hidden flex">
          {categoryData.map((cat) => {
            const w = contextWindow > 0 ? (cat.value / contextWindow) * 100 : 0;
            return (
              <div
                key={cat.name}
                style={{ width: `${String(Math.max(w, 0.3))}%` }}
                className={`h-full ${CATEGORY_BG[cat.category] ?? DEFAULT_CATEGORY_BG}`}
                title={`${cat.name}: ${cat.value.toLocaleString()} tokens`}
              />
            );
          })}
        </div>
      </div>

      {/* Category breakdown */}
      <div className="mb-6">
        <h2 className="text-sm font-semibold text-foreground mb-3">By Category</h2>
        <div className="space-y-1.5">
          {categoryData.map((cat) => {
            const pct = promptTokens > 0 ? Math.round((cat.value / promptTokens) * 100) : 0;
            return (
              <div key={cat.name} className="flex items-center gap-3">
                <div className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${CATEGORY_BG[cat.category] ?? DEFAULT_CATEGORY_BG}`} />
                <div className="w-28 text-xs text-muted-foreground font-medium">{cat.name}</div>
                <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
                  <div className={`h-full rounded-full ${CATEGORY_BG[cat.category] ?? DEFAULT_CATEGORY_BG}`} style={{ width: `${String(pct)}%` }} />
                </div>
                <div className="w-16 text-right text-xs text-muted-foreground tabular-nums">{cat.value.toLocaleString()}</div>
                <div className="w-8 text-right text-xs text-muted-foreground tabular-nums">{pct}%</div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Top contributors — individual files */}
      <div className="mb-6">
        <h2 className="text-sm font-semibold text-foreground mb-3">Top Contributors</h2>
        <div className="space-y-1">
          {top10.map((c) => {
            const pct = promptTokens > 0 ? Math.round((c.tokens / promptTokens) * 100) : 0;
            const nameEl = c.filePath ? (
              <button
                onClick={() => { void navigate(`/config/files?open=${encodeURIComponent(c.filePath!)}`); }}
                className="w-40 text-xs text-primary font-medium truncate text-left hover:underline"
                title={`${c.name} — click to view file`}
              >
                {c.name}
              </button>
            ) : (
              <div className="w-40 text-xs text-muted-foreground font-medium truncate" title={c.name}>
                {c.name}
              </div>
            );
            return (
              <div key={c.name} className="flex items-center gap-3">
                <div className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${CATEGORY_BG[c.category] ?? DEFAULT_CATEGORY_BG}`} />
                {nameEl}
                <span className="text-[10px] text-muted-foreground w-16 truncate" title={c.category}>
                  {categoryLabel(c.category)}
                </span>
                <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full ${CATEGORY_BG[c.category] ?? DEFAULT_CATEGORY_BG}`}
                    style={{ width: `${String(pct)}%` }}
                  />
                </div>
                <div className="w-16 text-right text-xs text-muted-foreground tabular-nums">
                  {c.tokens.toLocaleString()}
                </div>
                <div className="w-8 text-right text-xs text-muted-foreground tabular-nums">
                  {pct}%
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Full prompt */}
      <div>
        <button
          onClick={() => setShowPrompt(!showPrompt)}
          className="flex items-center gap-2 text-sm text-muted-foreground hover:text-primary transition-colors mb-3"
        >
          <FileText className="h-4 w-4" />
          {showPrompt ? 'Hide full prompt' : 'View full prompt'} ({data.system_prompt_length.toLocaleString()} chars)
        </button>
        {showPrompt && (
          <pre className="bg-card border border-border rounded-xl p-4 text-xs text-foreground font-mono whitespace-pre-wrap overflow-auto max-h-[600px] scrollbar-thin leading-relaxed">
            {data.system_prompt}
          </pre>
        )}
      </div>
    </div>
  );
}
