/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import { fetchFromRuntime } from '@/lib/runtime-client';
import { AgentOffline } from '@/components/AgentOffline';
export const dynamic = 'force-dynamic';

interface PromptContribution {
  source: string;
  tokens: number;
}

interface ContextData {
  prompt: string;
  totalTokens?: number;
  contributions?: PromptContribution[];
}

function TokenBar({ contribution, maxTokens }: { contribution: PromptContribution; maxTokens: number }) {
  const pct = maxTokens > 0 ? (contribution.tokens / maxTokens) * 100 : 0;
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-sm">
        <span className="text-foreground">{contribution.source}</span>
        <span className="text-muted-foreground tabular-nums">{contribution.tokens.toLocaleString()}</span>
      </div>
      <div className="h-2 bg-muted rounded-full overflow-hidden">
        <div
          className="h-full bg-primary/60 rounded-full"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

export default async function PromptPage() {
  let context: ContextData;
  try {
    context = await fetchFromRuntime<ContextData>('/inspect/context');
  } catch {
    return <AgentOffline page="prompt" />;
  }

  const maxTokens = context.contributions?.reduce(
    (max, c) => Math.max(max, c.tokens),
    0,
  ) ?? 0;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-foreground">System Prompt</h1>
        {context.totalTokens != null && (
          <span className="text-sm text-muted-foreground">
            {context.totalTokens.toLocaleString()} tokens
          </span>
        )}
      </div>

      {/* Token breakdown */}
      {context.contributions && context.contributions.length > 0 && (
        <div className="bg-card border border-border rounded-lg p-4">
          <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wide mb-3">
            Token Breakdown
          </h2>
          <div className="space-y-3">
            {context.contributions.map((c) => (
              <TokenBar key={c.source} contribution={c} maxTokens={maxTokens} />
            ))}
          </div>
        </div>
      )}

      {/* Full prompt */}
      <div className="bg-card border border-border rounded-lg p-4">
        <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wide mb-3">
          Full Prompt
        </h2>
        <pre className="text-sm text-foreground whitespace-pre-wrap break-words font-mono bg-muted rounded p-4 max-h-[600px] overflow-y-auto scrollbar-thin">
          {context.prompt}
        </pre>
      </div>
    </div>
  );
}
