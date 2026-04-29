/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import { useState, useEffect } from 'react';
import { AgentOffline } from '@/components/AgentOffline';
import { useStudioConfig } from '../contexts/StudioConfigContext';
import { PROVIDER_COLORS, modelToProvider, estimateCost } from '../lib/model-pricing';

interface SessionRow {
  id: string;
  title: string;
  message_count: number;
  token_usage: { input_tokens: number; output_tokens: number; total_tokens: number };
  model: string | null;
  provider: string | null;
  created_at: string;
  updated_at: string;
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

export function SessionsPage() {
  const { runtimeUrl } = useStudioConfig();
  const [sessions, setSessions] = useState<SessionRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`${runtimeUrl}/sessions/history`, { signal: AbortSignal.timeout(5_000) })
      .then((r) => {
        if (!r.ok) throw new Error(`Runtime returned ${String(r.status)}`);
        // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- system boundary
        return r.json() as Promise<SessionRow[]>;
      })
      .then(setSessions)
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : String(err));
      });
  }, [runtimeUrl]);

  if (error) return <AgentOffline page="sessions" detail={error} />;
  if (!sessions) return null;

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold text-foreground">Sessions</h1>

      {sessions.length === 0 ? (
        <p className="text-sm text-muted-foreground">No sessions yet.</p>
      ) : (
        <div className="border border-border rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-card text-muted-foreground text-xs uppercase">
                <th className="text-left px-4 py-2 font-medium">Title</th>
                <th className="text-left px-4 py-2 font-medium">Model</th>
                <th className="text-right px-4 py-2 font-medium">Messages</th>
                <th className="text-right px-4 py-2 font-medium">Tokens</th>
                <th className="text-right px-4 py-2 font-medium">Est. Cost</th>
                <th className="text-right px-4 py-2 font-medium">Last Active</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {sessions.map((s) => {
                const cost = s.model
                  ? estimateCost(s.model, s.token_usage.input_tokens, s.token_usage.output_tokens)
                  : null;
                const colors = s.model ? PROVIDER_COLORS[modelToProvider(s.model)] : null;
                return (
                  <tr key={s.id} className="hover:bg-muted/50">
                    <td className="px-4 py-2.5 text-foreground max-w-xs truncate">{s.title}</td>
                    <td className="px-4 py-2.5">
                      {s.model ? (
                        <div className="flex items-center gap-1.5">
                          {colors && <span className={`w-1.5 h-1.5 rounded-full ${colors.dot}`} />}
                          <span className="font-mono text-xs text-muted-foreground">{s.model}</span>
                        </div>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-right text-muted-foreground">{s.message_count}</td>
                    <td className="px-4 py-2.5 text-right font-mono text-xs text-muted-foreground">
                      {formatTokens(s.token_usage.total_tokens)}
                    </td>
                    <td className="px-4 py-2.5 text-right font-mono text-xs text-foreground">
                      {cost != null ? `$${cost.toFixed(3)}` : '—'}
                    </td>
                    <td className="px-4 py-2.5 text-right text-xs text-muted-foreground">
                      {formatDate(s.updated_at)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
