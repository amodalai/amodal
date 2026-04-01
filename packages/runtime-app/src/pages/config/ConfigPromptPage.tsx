/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import { useEffect, useState } from 'react';
import { FileText } from 'lucide-react';

interface PromptSection {
  name: string;
  tokens: number;
  priority: number;
  trimmed: boolean;
}

interface PromptData {
  system_prompt: string;
  system_prompt_length: number;
  token_usage: {
    total: number;
    used: number;
    remaining: number;
    sectionBreakdown: Record<string, number>;
  };
  sections: PromptSection[];
}

export function ConfigPromptPage() {
  const [data, setData] = useState<PromptData | null>(null);
  const [showPrompt, setShowPrompt] = useState(false);

  useEffect(() => {
    fetch('/inspect/context')
      .then((res) => (res.ok ? res.json() : null))
      .then((d: unknown) => {
        if (d) {
          // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- Server response
          setData(d as PromptData);
        }
      })
      .catch(() => {});
  }, []);

  if (!data) return <div className="p-8 text-gray-400 dark:text-zinc-500 text-sm">Loading...</div>;

  const usedPct = Math.round((data.token_usage.used / data.token_usage.total) * 100);

  return (
    <div className="p-8 max-w-2xl">
      <h1 className="text-lg font-semibold text-gray-900 dark:text-zinc-200 mb-2">System Prompt</h1>
      <p className="text-sm text-gray-500 dark:text-zinc-500 mb-6">
        The compiled prompt the LLM receives at the start of every session.
      </p>

      {/* Token usage bar */}
      <div className="mb-6">
        <div className="flex items-center justify-between text-xs text-gray-500 dark:text-zinc-400 mb-1.5">
          <span>{data.token_usage.used.toLocaleString()} tokens used</span>
          <span>{data.token_usage.total.toLocaleString()} context window</span>
        </div>
        <div className="h-3 bg-gray-200 dark:bg-zinc-800 rounded-full overflow-hidden">
          <div
            className={`h-full rounded-full transition-all ${usedPct > 80 ? 'bg-amber-500' : 'bg-blue-600'}`}
            style={{ width: `${String(usedPct)}%` }}
          />
        </div>
        <div className="text-xs text-gray-400 dark:text-zinc-600 mt-1">
          {usedPct}% used — {data.token_usage.remaining.toLocaleString()} tokens remaining for conversation
        </div>
      </div>

      {/* Sections breakdown */}
      <div className="mb-6">
        <h2 className="text-sm font-semibold text-gray-800 dark:text-zinc-300 mb-3">Sections</h2>
        <div className="space-y-2">
          {data.sections.map((s) => {
            const pct = data.token_usage.used > 0 ? Math.round((s.tokens / data.token_usage.used) * 100) : 0;
            return (
              <div key={s.name} className="flex items-center gap-3">
                <div className="w-28 text-xs text-gray-600 dark:text-zinc-400 font-medium truncate">{s.name}</div>
                <div className="flex-1 h-2 bg-gray-200 dark:bg-zinc-800 rounded-full overflow-hidden">
                  <div className="h-full bg-blue-400/60 rounded-full" style={{ width: `${String(pct)}%` }} />
                </div>
                <div className="w-20 text-right text-xs text-gray-500 dark:text-zinc-500 tabular-nums">
                  {s.tokens.toLocaleString()}
                </div>
                {s.trimmed && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-100 dark:bg-amber-500/10 text-amber-700 dark:text-amber-400">trimmed</span>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Full prompt */}
      <div>
        <button
          onClick={() => setShowPrompt(!showPrompt)}
          className="flex items-center gap-2 text-sm text-gray-600 dark:text-zinc-400 hover:text-blue-700 dark:hover:text-blue-400 transition-colors mb-3"
        >
          <FileText className="h-4 w-4" />
          {showPrompt ? 'Hide full prompt' : 'View full prompt'} ({data.system_prompt_length.toLocaleString()} chars)
        </button>
        {showPrompt && (
          <pre className="bg-gray-50 dark:bg-zinc-900/50 border border-gray-200 dark:border-zinc-800 rounded-xl p-4 text-xs text-gray-700 dark:text-zinc-300 font-mono whitespace-pre-wrap overflow-auto max-h-[600px] scrollbar-thin leading-relaxed">
            {data.system_prompt}
          </pre>
        )}
      </div>
    </div>
  );
}
