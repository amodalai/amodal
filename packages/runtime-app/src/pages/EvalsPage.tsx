/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import { useEffect, useState } from 'react';
import { CheckCircle2, XCircle, FlaskConical, Loader2, Play, Trophy } from 'lucide-react';
import { cn } from '@/lib/utils';

type TabId = 'suites' | 'arena';

interface EvalSuite {
  name: string;
  title: string;
  description: string;
  query: string;
  assertionCount: number;
  assertions: Array<{ text: string; negated: boolean }>;
}

interface EvalRunSummary {
  id: string;
  model: { provider: string; model: string };
  passRate: number;
  totalPassed: number;
  totalFailed: number;
  totalDurationMs: number;
  totalCostMicros: number;
  label?: string;
  triggeredBy: string;
  createdAt: string;
}

interface ArenaModel {
  provider: string;
  model: string;
  label?: string;
}

function formatCost(micros: number): string {
  if (micros === 0) return '$0.00';
  return `$${(micros / 1_000_000).toFixed(2)}`;
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function formatRelativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function PassRateBadge({ rate }: { rate: number }) {
  const pct = Math.round(rate * 100);
  const color = pct === 100 ? 'text-emerald-400' : pct >= 90 ? 'text-blue-400' : pct >= 80 ? 'text-amber-400' : 'text-red-400';
  return <span className={cn('font-semibold', color)}>{pct}%</span>;
}

/* ------------------------------------------------------------------ */
/*  Tab: Eval Suites                                                   */
/* ------------------------------------------------------------------ */

interface AssertionResult {
  text: string;
  negated: boolean;
  passed: boolean;
  reason: string;
}

interface CostInfo {
  estimatedCostMicros: number;
  inputTokens: number;
  outputTokens: number;
}

interface EvalResultDetail {
  response: string;
  toolCalls: Array<{ name: string; parameters: Record<string, unknown> }>;
  assertions: AssertionResult[];
  durationMs: number;
  error?: string;
  queryCost?: CostInfo;
  judgeCost?: CostInfo;
}

interface RunResult {
  evalName: string;
  passed: boolean;
  result?: EvalResultDetail;
  liveText?: string;
  liveTools?: Array<{ name: string; status?: string }>;
  phase?: 'querying' | 'judging' | 'done';
}

function EvalResultCard({ result: r }: { result: RunResult }) {
  const isLive = r.phase === 'querying' || r.phase === 'judging';
  const [expanded, setExpanded] = useState(true);

  return (
    <div className={cn('border rounded-lg overflow-hidden',
      isLive ? 'border-indigo-500/30' : r.passed ? 'border-emerald-500/20' : 'border-red-500/30',
    )}>
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-2 text-xs px-3 py-2 hover:bg-gray-50 dark:hover:bg-zinc-800/20 transition-colors"
      >
        {isLive ? (
          <Loader2 className="h-3.5 w-3.5 text-indigo-400 animate-spin shrink-0" />
        ) : r.passed ? (
          <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
        ) : (
          <XCircle className="h-3.5 w-3.5 text-red-400 shrink-0" />
        )}
        <span className="text-gray-700 dark:text-zinc-300 font-medium">{r.evalName}</span>
        {r.result && (
          <>
            <span className="text-gray-400 dark:text-zinc-600 ml-1">{formatDuration(r.result.durationMs)}</span>
            {r.result.queryCost && (
              <span className="text-gray-400 dark:text-zinc-600 font-mono text-[10px]" title="Query cost">
                Q:{formatCost(r.result.queryCost.estimatedCostMicros)}
              </span>
            )}
            {r.result.judgeCost && (
              <span className="text-gray-400 dark:text-zinc-600 font-mono text-[10px]" title="Judge cost">
                J:{formatCost(r.result.judgeCost.estimatedCostMicros)}
              </span>
            )}
          </>
        )}
        <span className={cn('ml-auto font-semibold',
          isLive ? 'text-indigo-400' : r.passed ? 'text-emerald-400' : 'text-red-400',
        )}>
          {isLive ? 'Running...' : r.passed ? 'PASS' : 'FAIL'}
        </span>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
          className={cn('text-gray-400 transition-transform', expanded && 'rotate-180')}>
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {expanded && (
        <div className="border-t border-gray-100 dark:border-zinc-800/50 px-3 py-3 space-y-3 bg-gray-50/50 dark:bg-zinc-900/20">
          {/* Live streaming text */}
          {isLive && (
            <>
              {(r.liveTools ?? []).length > 0 && (
                <div className="space-y-1">
                  {(r.liveTools ?? []).map((t, i) => (
                    <div key={i} className="flex items-center gap-2 text-xs px-2 py-1 rounded bg-gray-100 dark:bg-zinc-800/40 font-mono">
                      {t.status ? (
                        <CheckCircle2 className="h-3 w-3 text-emerald-400 shrink-0" />
                      ) : (
                        <Loader2 className="h-3 w-3 text-indigo-400 animate-spin shrink-0" />
                      )}
                      <span className="text-indigo-500 font-semibold">{t.name}</span>
                    </div>
                  ))}
                </div>
              )}
              {r.liveText && (
                <div className="text-xs text-gray-700 dark:text-zinc-300 bg-white dark:bg-zinc-800/50 border border-gray-200 dark:border-zinc-700/50 rounded px-3 py-2 max-h-48 overflow-y-auto whitespace-pre-wrap">
                  {r.liveText}
                  <span className="inline-block w-1.5 h-3.5 bg-indigo-400 animate-pulse ml-0.5 align-text-bottom" />
                </div>
              )}
              {!r.liveText && (r.liveTools ?? []).length === 0 && (
                <div className="flex items-center gap-2 text-xs text-gray-400 dark:text-zinc-500">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Querying agent...
                </div>
              )}
            </>
          )}

          {/* Completed result */}
          {r.result && (
            <>
              {r.result.error && (
                <div className="text-xs text-red-400 bg-red-500/5 border border-red-500/20 rounded px-3 py-2 font-mono">
                  {r.result.error}
                </div>
              )}

              {r.result.response && (
                <div>
                  <div className="text-[10px] font-semibold text-gray-400 dark:text-zinc-500 uppercase tracking-widest mb-1">Response</div>
                  <div className="text-xs text-gray-700 dark:text-zinc-300 bg-white dark:bg-zinc-800/50 border border-gray-200 dark:border-zinc-700/50 rounded px-3 py-2 max-h-48 overflow-y-auto whitespace-pre-wrap">
                    {r.result.response}
                  </div>
                </div>
              )}

              {r.result.toolCalls.length > 0 && (
                <div>
                  <div className="text-[10px] font-semibold text-gray-400 dark:text-zinc-500 uppercase tracking-widest mb-1">Tool Calls</div>
                  <div className="space-y-1">
                    {r.result.toolCalls.map((tc, i) => (
                      <div key={i} className="flex items-center gap-2 text-xs px-2 py-1 rounded bg-gray-100 dark:bg-zinc-800/40 font-mono">
                        <span className="text-indigo-500 font-semibold">{tc.name}</span>
                        {tc.parameters['connection'] && (
                          <span className="text-gray-500 dark:text-zinc-500">{String(tc.parameters['connection'])}</span>
                        )}
                        {tc.parameters['path'] && (
                          <span className="text-gray-400 dark:text-zinc-600">{String(tc.parameters['path'])}</span>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {r.result.assertions.length > 0 && (
                <div>
                  <div className="text-[10px] font-semibold text-gray-400 dark:text-zinc-500 uppercase tracking-widest mb-1">Assertions</div>
                  <div className="space-y-1.5">
                    {r.result.assertions.map((a, i) => (
                      <div key={i} className={cn('text-xs rounded px-3 py-2 border', a.passed ? 'border-emerald-500/20 bg-emerald-500/5' : 'border-red-500/20 bg-red-500/5')}>
                        <div className="flex items-center gap-2">
                          {a.passed ? (
                            <CheckCircle2 className="h-3 w-3 text-emerald-400 shrink-0" />
                          ) : (
                            <XCircle className="h-3 w-3 text-red-400 shrink-0" />
                          )}
                          <span className={a.passed ? 'text-emerald-300' : 'text-red-300'}>{a.negated ? 'NOT ' : ''}{a.text}</span>
                        </div>
                        {a.reason && (
                          <div className="mt-1 ml-5 text-gray-500 dark:text-zinc-500 italic">{a.reason}</div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

function SuitesTab({ suites, runs, onRunComplete }: { suites: EvalSuite[]; runs: EvalRunSummary[]; onRunComplete: () => void }) {
  const [expandedSuite, setExpandedSuite] = useState<string | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [progress, setProgress] = useState<{ current: number; total: number; evalName: string } | null>(null);
  const [runResults, setRunResults] = useState<RunResult[]>([]);

  const handleRunSuite = async () => {
    setIsRunning(true);
    setProgress(null);
    setRunResults([]);

    const resp = await fetch('/api/evals/run', { method: 'POST' });
    if (!resp.ok || !resp.body) {
      setIsRunning(false);
      return;
    }

    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        try {
          const event: unknown = JSON.parse(line.slice(6));
          if (!event || typeof event !== 'object') continue;
          // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- SSE event
          const e = event as Record<string, unknown>;
          const type = String(e['type'] ?? '');

          const evalName = String(e['evalName'] ?? '');

          if (type === 'eval_start' && evalName) {
            setProgress({ current: Number(e['current'] ?? 0), total: Number(e['total'] ?? 0), evalName });
            // Add a live entry
            setRunResults((prev) => [...prev, { evalName, passed: false, phase: 'querying', liveText: '', liveTools: [] }]);
          } else if (type === 'agent_text' && evalName) {
            // Stream text into the live entry
            setRunResults((prev) => prev.map((r) =>
              r.evalName === evalName ? { ...r, liveText: (r.liveText ?? '') + String(e['content'] ?? '') } : r,
            ));
          } else if (type === 'agent_tool' && evalName) {
            setRunResults((prev) => prev.map((r) =>
              r.evalName === evalName ? { ...r, liveTools: [...(r.liveTools ?? []), { name: String(e['toolName'] ?? 'request') }] } : r,
            ));
          } else if (type === 'agent_tool_result' && evalName) {
            setRunResults((prev) => prev.map((r) =>
              r.evalName === evalName ? {
                ...r,
                liveTools: (r.liveTools ?? []).map((t, i) => i === (r.liveTools ?? []).length - 1 ? { ...t, status: String(e['status'] ?? 'success') } : t),
              } : r,
            ));
          } else if (type === 'eval_complete' && evalName) {
            // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- SSE result
            const result = e['result'] as EvalResultDetail | undefined;
            setRunResults((prev) => prev.map((r) =>
              r.evalName === evalName ? { evalName, passed: Boolean(e['passed']), result, phase: 'done' } : r,
            ));
            setProgress({ current: Number(e['current'] ?? 0), total: Number(e['total'] ?? 0), evalName });
          } else if (type === 'run_complete' || type === 'done') {
            setIsRunning(false);
            setProgress(null);
            onRunComplete();
          }
        } catch {
          // skip
        }
      }
    }

    setIsRunning(false);
    setProgress(null);
  };

  if (suites.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <FlaskConical className="h-12 w-12 text-indigo-500/20 mb-4" />
        <h3 className="text-sm font-semibold text-gray-400 dark:text-zinc-400 mb-2">No evals defined</h3>
        <p className="text-xs text-gray-400 dark:text-zinc-500 max-w-sm">
          Create eval files in the <code className="px-1 py-0.5 rounded bg-gray-100 dark:bg-zinc-800">evals/</code> directory. Each eval is a markdown file with a query and assertions.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {suites.map((suite) => {
        const isExpanded = expandedSuite === suite.name;
        return (
          <div key={suite.name} className="border border-gray-200 dark:border-zinc-800 rounded-lg overflow-hidden">
            <button
              onClick={() => setExpandedSuite(isExpanded ? null : suite.name)}
              className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-gray-50 dark:hover:bg-zinc-800/30 transition-colors"
            >
              <FlaskConical className="h-4 w-4 text-indigo-500/60 shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium text-gray-900 dark:text-zinc-200">{suite.title || suite.name}</div>
                {suite.description && (
                  <div className="text-xs text-gray-400 dark:text-zinc-500 truncate">{suite.description}</div>
                )}
              </div>
              <span className="text-[11px] text-gray-400 dark:text-zinc-500 tabular-nums">
                {suite.assertionCount} assertion{suite.assertionCount !== 1 ? 's' : ''}
              </span>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                className={cn('text-gray-400 dark:text-zinc-500 transition-transform', isExpanded && 'rotate-180')}>
                <polyline points="6 9 12 15 18 9" />
              </svg>
            </button>

            {isExpanded && (
              <div className="border-t border-gray-100 dark:border-zinc-800/50 px-4 py-3 bg-gray-50/50 dark:bg-zinc-900/30">
                <div className="mb-3">
                  <div className="text-[10px] font-semibold text-gray-400 dark:text-zinc-500 uppercase tracking-widest mb-1">Query</div>
                  <div className="text-sm text-gray-700 dark:text-zinc-300 bg-white dark:bg-zinc-800/50 border border-gray-200 dark:border-zinc-700/50 rounded px-3 py-2 font-mono">
                    {suite.query}
                  </div>
                </div>
                <div>
                  <div className="text-[10px] font-semibold text-gray-400 dark:text-zinc-500 uppercase tracking-widest mb-1">Assertions</div>
                  <div className="space-y-1">
                    {suite.assertions.map((a, i) => (
                      <div key={i} className="flex items-center gap-2 text-xs text-gray-600 dark:text-zinc-400">
                        <span className={a.negated ? 'text-red-400' : 'text-emerald-400'}>{a.negated ? 'NOT' : 'SHOULD'}</span>
                        <span>{a.text}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>
        );
      })}

      {/* Run Controls */}
      <div className="flex items-center gap-3 mt-2">
        <button
          onClick={() => { void handleRunSuite(); }}
          disabled={isRunning}
          className="px-4 py-2 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-500 disabled:opacity-30 transition-colors flex items-center gap-2"
        >
          {isRunning ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
          Run Suite
        </button>
        {progress && (
          <div className="flex items-center gap-2 text-xs text-gray-500 dark:text-zinc-400">
            <div className="w-32 h-1.5 bg-gray-200 dark:bg-zinc-800 rounded-full overflow-hidden">
              <div className="h-full bg-indigo-500 rounded-full transition-all" style={{ width: `${(progress.current / progress.total) * 100}%` }} />
            </div>
            <span>{progress.current}/{progress.total}</span>
            <span className="text-gray-400 dark:text-zinc-600">{progress.evalName}</span>
          </div>
        )}
      </div>

      {/* Live Results */}
      {runResults.length > 0 && (
        <div className="mt-3 space-y-2">
          {runResults.map((r) => (
            <EvalResultCard key={r.evalName} result={r} />
          ))}
        </div>
      )}

      {/* Recent Runs */}
      {runs.length > 0 && (
        <div className="mt-6">
          <h3 className="text-xs font-semibold text-gray-400 dark:text-zinc-500 uppercase tracking-widest mb-3">Recent Runs</h3>
          <div className="border border-gray-200 dark:border-zinc-800 rounded-lg overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 dark:bg-zinc-900/50 text-xs text-gray-500 dark:text-zinc-500">
                  <th className="text-left px-4 py-2 font-medium">Model</th>
                  <th className="text-right px-4 py-2 font-medium">Pass Rate</th>
                  <th className="text-right px-4 py-2 font-medium">Duration</th>
                  <th className="text-right px-4 py-2 font-medium">Cost</th>
                  <th className="text-right px-4 py-2 font-medium">When</th>
                </tr>
              </thead>
              <tbody>
                {runs.map((run) => (
                  <tr key={run.id} className="border-t border-gray-100 dark:border-zinc-800/50 hover:bg-gray-50/50 dark:hover:bg-zinc-800/20">
                    <td className="px-4 py-2.5 text-gray-800 dark:text-zinc-300 font-medium">
                      {run.model.model.replace(/-\d{8}$/, '')}
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <PassRateBadge rate={run.passRate} />
                      <span className="text-gray-400 dark:text-zinc-600 ml-1 text-xs">({run.totalPassed}/{run.totalPassed + run.totalFailed})</span>
                    </td>
                    <td className="px-4 py-2.5 text-right text-gray-400 dark:text-zinc-500">{formatDuration(run.totalDurationMs)}</td>
                    <td className="px-4 py-2.5 text-right text-gray-400 dark:text-zinc-500 font-mono text-xs">{formatCost(run.totalCostMicros)}</td>
                    <td className="px-4 py-2.5 text-right text-gray-400 dark:text-zinc-500 text-xs">{formatRelativeTime(run.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Tab: Model Arena                                                    */
/* ------------------------------------------------------------------ */

interface ArenaResult {
  model: ArenaModel;
  passRate: number;
  totalPassed: number;
  totalFailed: number;
  avgDurationMs: number;
  costMicros: number;
}

function ArenaTab({ suites }: { suites: EvalSuite[] }) {
  const [models, setModels] = useState<ArenaModel[]>([]);
  const [selectedModels, setSelectedModels] = useState<Set<string>>(new Set());
  const [results, _setResults] = useState<ArenaResult[]>([]);
  const [_isRunning, _setIsRunning] = useState(false);

  useEffect(() => {
    fetch('/api/evals/arena/models')
      .then((res) => res.json())
      .then((data: unknown) => {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- server response
        const d = data as { models: ArenaModel[] };
        setModels(d.models);
        setSelectedModels(new Set(d.models.map((m) => `${m.provider}/${m.model}`)));
      })
      .catch(() => {});
  }, []);

  const toggleModel = (key: string) => {
    setSelectedModels((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  return (
    <div className="space-y-4">
      {/* Model Selection */}
      <div className="flex flex-wrap gap-2">
        {models.map((m) => {
          const key = `${m.provider}/${m.model}`;
          const selected = selectedModels.has(key);
          return (
            <button
              key={key}
              onClick={() => toggleModel(key)}
              className={cn(
                'px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors',
                selected
                  ? 'border-indigo-500/50 bg-indigo-500/10 text-indigo-400'
                  : 'border-gray-200 dark:border-zinc-700/50 text-gray-400 dark:text-zinc-500 hover:border-gray-300 dark:hover:border-zinc-600',
              )}
            >
              {m.label || m.model.replace(/-\d{8}$/, '')}
            </button>
          );
        })}
      </div>

      {/* Run Button */}
      <div className="flex items-center gap-3">
        {suites.length > 0 && (
          <span className="text-xs text-gray-400 dark:text-zinc-500">
            {suites.length} eval{suites.length !== 1 ? 's' : ''} in suite
          </span>
        )}
        <button
          disabled
          className="ml-auto px-4 py-2 rounded-lg bg-indigo-600 text-white text-sm font-medium disabled:opacity-30 transition-colors flex items-center gap-2"
          title="Coming soon — requires API keys for each model"
        >
          <Play className="h-4 w-4" />
          Run Arena
        </button>
      </div>
      <div className="text-xs text-gray-400 dark:text-zinc-500 bg-indigo-500/5 border border-indigo-500/20 rounded-lg px-3 py-2">
        Arena runs require API keys for each selected model. Configure models in <code className="px-1 py-0.5 rounded bg-gray-100 dark:bg-zinc-800">amodal.json</code> under <code className="px-1 py-0.5 rounded bg-gray-100 dark:bg-zinc-800">arena.models</code>.
      </div>

      {/* Results Table */}
      {results.length > 0 && (
        <div className="border border-gray-200 dark:border-zinc-800 rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 dark:bg-zinc-900/50 text-xs text-gray-500 dark:text-zinc-500">
                <th className="text-left px-4 py-3 font-medium">Model</th>
                <th className="text-right px-4 py-3 font-medium">Pass Rate</th>
                <th className="text-right px-4 py-3 font-medium">Avg Latency</th>
                <th className="text-right px-4 py-3 font-medium">Cost / Run</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {results.sort((a, b) => b.passRate - a.passRate).map((r, i) => (
                <tr key={`${r.model.provider}-${r.model.model}`} className="border-t border-gray-100 dark:border-zinc-800/50">
                  <td className="px-4 py-3 text-gray-800 dark:text-zinc-300 font-medium flex items-center gap-2">
                    {i === 0 && <Trophy className="h-3.5 w-3.5 text-amber-400" />}
                    {r.model.label || r.model.model.replace(/-\d{8}$/, '')}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <PassRateBadge rate={r.passRate} />
                    <span className="text-gray-400 dark:text-zinc-600 ml-1 text-xs">({r.totalPassed}/{r.totalPassed + r.totalFailed})</span>
                  </td>
                  <td className="px-4 py-3 text-right text-gray-400 dark:text-zinc-500">{formatDuration(r.avgDurationMs)}</td>
                  <td className="px-4 py-3 text-right text-gray-400 dark:text-zinc-500 font-mono text-xs">{formatCost(r.costMicros)}</td>
                  <td className="px-4 py-3 text-right">
                    {i === 0 ? (
                      <span className="px-2 py-1 text-[10px] font-medium bg-emerald-500/10 text-emerald-400 rounded">Best</span>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {results.length === 0 && !isRunning && (
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <Trophy className="h-10 w-10 text-amber-500/20 mb-3" />
          <h3 className="text-sm font-semibold text-gray-400 dark:text-zinc-400 mb-1">No arena results yet</h3>
          <p className="text-xs text-gray-400 dark:text-zinc-500 max-w-sm">
            Select models and run the arena to compare their performance on your eval suite.
          </p>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Tab: Health                                                        */
/* ------------------------------------------------------------------ */


/* ------------------------------------------------------------------ */
/*  Main Page                                                          */
/* ------------------------------------------------------------------ */

const tabs: Array<{ id: TabId; label: string }> = [
  { id: 'suites', label: 'Eval Suites' },
  { id: 'arena', label: 'Model Arena' },
];

export function EvalsPage() {
  const [activeTab, setActiveTab] = useState<TabId>('suites');
  const [suites, setSuites] = useState<EvalSuite[]>([]);
  const [runs, setRuns] = useState<EvalRunSummary[]>([]);

  useEffect(() => {
    fetch('/api/evals/suites')
      .then((res) => res.json())
      .then((data: unknown) => {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- server response
        const d = data as { suites: EvalSuite[] };
        setSuites(d.suites);
      })
      .catch(() => {});

    fetch('/api/evals/runs')
      .then((res) => res.json())
      .then((data: unknown) => {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- server response
        const d = data as { runs: EvalRunSummary[] };
        setRuns(d.runs);
      })
      .catch(() => {});
  }, []);

  return (
    <div className="h-full flex flex-col bg-white dark:bg-[#0a0a0f]">
      {/* Header */}
      <div className="border-b border-gray-200 dark:border-zinc-800/50 px-6 py-4">
        <div className="flex items-center gap-2 mb-4">
          <FlaskConical className="h-5 w-5 text-indigo-500" />
          <h1 className="text-lg font-semibold text-gray-900 dark:text-zinc-200">Evals</h1>
        </div>

        {/* Tabs */}
        <div className="flex gap-1">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={cn(
                'px-4 py-2 text-sm font-medium rounded-lg transition-colors',
                activeTab === tab.id
                  ? 'bg-indigo-500/10 text-indigo-600 dark:text-indigo-400'
                  : 'text-gray-500 dark:text-zinc-500 hover:text-gray-800 dark:hover:text-zinc-300 hover:bg-gray-100 dark:hover:bg-zinc-800/30',
              )}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto scrollbar-thin">
        <div className="max-w-4xl mx-auto px-6 py-6">
          {activeTab === 'suites' && <SuitesTab suites={suites} runs={runs} onRunComplete={() => {
            fetch('/api/evals/runs').then((r) => r.json()).then((d: unknown) => {
              // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- server response
              setRuns((d as { runs: EvalRunSummary[] }).runs);
            }).catch(() => {});
          }} />}
          {activeTab === 'arena' && <ArenaTab suites={suites} />}
        </div>
      </div>
    </div>
  );
}
