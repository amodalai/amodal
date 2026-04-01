/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import { useEffect, useState, useCallback, useRef } from 'react';
import { CheckCircle2, XCircle, FlaskConical, Loader2, ChevronDown, Play } from 'lucide-react';
import { cn } from '@/lib/utils';

/* ------------------------------------------------------------------ */
/*  Types                                                               */
/* ------------------------------------------------------------------ */

interface EvalSuite {
  name: string;
  title: string;
  description: string;
  query: string;
  assertionCount: number;
  assertions: Array<{ text: string; negated: boolean }>;
}

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
  cacheReadInputTokens?: number;
}

interface EvalResultDetail {
  response: string;
  toolCalls: Array<{ name: string; parameters: Record<string, unknown> }>;
  toolResults?: string[];
  assertions: AssertionResult[];
  durationMs: number;
  error?: string;
  queryCost?: CostInfo;
  judgeCost?: CostInfo;
}

interface CardResult {
  passed: boolean;
  result?: EvalResultDetail;
  error?: string;
  phase?: 'querying' | 'judging' | 'done';
}

interface EvalHistoryEntry {
  runId: string;
  passed: boolean;
  durationMs: number;
  queryCostMicros: number;
  judgeCostMicros: number;
  timestamp: string;
  model: string;
  assertions: Array<{ passed: boolean }>;
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                             */
/* ------------------------------------------------------------------ */

function formatCost(micros: number): string {
  if (micros === 0) return '$0.00';
  const dollars = micros / 1_000_000;
  if (dollars < 0.01) return `$${dollars.toFixed(4)}`;
  return `$${dollars.toFixed(2)}`;
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

function CollapsibleText({ text, lines = 2 }: { text: string; lines?: number }) {
  const [expanded, setExpanded] = useState(false);
  const lineCount = text.split('\n').length;
  const needsCollapse = text.length > 200 || lineCount > lines;

  if (!needsCollapse) {
    return <div className="whitespace-pre-wrap break-words" style={{overflowWrap: 'anywhere'}}>{text}</div>;
  }

  return (
    <div>
      <div
        className={cn('whitespace-pre-wrap break-words', !expanded && 'line-clamp-2')}
        style={{overflowWrap: 'anywhere'}}
      >
        {text}
      </div>
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-1 mt-1 text-[10px] text-indigo-400 hover:text-indigo-300 transition-colors"
      >
        {expanded ? 'collapse' : `show all (${text.length > 1000 ? Math.round(text.length / 1000) + 'K chars' : text.length + ' chars'})`}
      </button>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  EvalCard                                                            */
/* ------------------------------------------------------------------ */

function EvalCard({ suite, expanded: expandedProp, onToggle, runTrigger, history }: {
  suite: EvalSuite;
  expanded: boolean;
  onToggle: () => void;
  runTrigger: number;
  history: EvalHistoryEntry[];
}) {
  const [isRunning, setIsRunning] = useState(false);
  const [cardResult, setCardResult] = useState<CardResult | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const lastRunTrigger = useRef(0);

  const handleRun = useCallback(async () => {
    setIsRunning(true);
    setCardResult({ passed: false, phase: 'querying' });

    try {
      const resp = await fetch('/api/evals/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ evalNames: [suite.name] }),
      });
      if (!resp.ok || !resp.body) {
        setCardResult({ passed: false, error: `Request failed: ${String(resp.status)}` });
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
            const parsed: unknown = JSON.parse(line.slice(6));
            if (!parsed || typeof parsed !== 'object') continue;
            const event = parsed as Record<string, unknown>; // eslint-disable-line @typescript-eslint/no-unsafe-type-assertion -- SSE parsing
            const type = String(event['type'] ?? '');
            if (type === 'done') {
              setCardResult((prev) => prev ? { ...prev, phase: 'judging' } : prev);
            } else if (type === 'eval_complete') {
              // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- SSE result
              const r = event['result'] as EvalResultDetail | undefined;
              setCardResult({
                passed: Boolean(event['passed']),
                result: r,
                phase: 'done',
              });
            } else if (type === 'agent_error') {
              setCardResult({ passed: false, error: String(event['error'] ?? 'Unknown error'), phase: 'done' });
            }
          } catch { /* skip */ }
        }
      }
    } catch (err) {
      setCardResult({ passed: false, error: (err as Error).message ?? 'Stream error', phase: 'done' }); // eslint-disable-line @typescript-eslint/no-unsafe-type-assertion -- error message
    } finally {
      setIsRunning(false);
    }
  }, [suite.name]);

  // Run when parent triggers run-all
  useEffect(() => {
    if (runTrigger > 0 && runTrigger !== lastRunTrigger.current && !isRunning) {
      lastRunTrigger.current = runTrigger;
      void handleRun();
    }
  }, [runTrigger, isRunning, handleRun]);

  const isDone = cardResult?.phase === 'done';
  const borderColor = !cardResult ? 'border-gray-200 dark:border-zinc-800'
    : isDone && cardResult.passed ? 'border-emerald-500/40'
    : isDone && !cardResult.passed ? 'border-red-500/40'
    : 'border-indigo-500/40';

  return (
    <div className={cn('border rounded-lg overflow-hidden transition-colors', borderColor)}>
      <div className="flex items-center gap-3 px-4 py-3">
        {/* Status indicator */}
        <div className="shrink-0">
          {!cardResult && <FlaskConical className="h-4 w-4 text-gray-300 dark:text-zinc-600" />}
          {cardResult && !isDone && <Loader2 className="h-4 w-4 animate-spin text-indigo-400" />}
          {isDone && cardResult.passed && <CheckCircle2 className="h-4 w-4 text-emerald-400" />}
          {isDone && !cardResult.passed && <XCircle className="h-4 w-4 text-red-400" />}
        </div>

        {/* Title + description */}
        <button
          onClick={onToggle}
          className="flex-1 min-w-0 text-left"
        >
          <div className="text-sm font-medium text-gray-900 dark:text-zinc-200">{suite.title || suite.name}</div>
          {suite.description && (
            <div className="text-xs text-gray-400 dark:text-zinc-500 truncate">{suite.description}</div>
          )}
        </button>

        {/* Stats */}
        {isDone && cardResult.result && (
          <div className="flex items-center gap-3 text-[11px] text-gray-400 dark:text-zinc-500 font-mono shrink-0">
            <span>{formatDuration(cardResult.result.durationMs)}</span>
            {cardResult.result.queryCost && (
              <span>{formatCost(cardResult.result.queryCost.estimatedCostMicros)}</span>
            )}
          </div>
        )}

        {cardResult && !isDone && (
          <span className="text-[11px] text-indigo-400 shrink-0">
            {cardResult.phase === 'judging' ? 'judging...' : 'running...'}
          </span>
        )}

        {/* Assertion dots */}
        {isDone && cardResult.result && (
          <span className="inline-flex items-center gap-0.5 shrink-0">
            {cardResult.result.assertions.map((a, i) => (
              <span key={i} className={cn('inline-block w-1.5 h-1.5 rounded-full', a.passed ? 'bg-emerald-400' : 'bg-red-400')} />
            ))}
            <span className="text-[10px] text-gray-400 dark:text-zinc-600 ml-1">
              {cardResult.result.assertions.filter((a) => a.passed).length}/{cardResult.result.assertions.length}
            </span>
          </span>
        )}

        {/* Run button */}
        {!isRunning && (
          <button
            onClick={(e) => { e.stopPropagation(); void handleRun(); }}
            className="h-7 w-7 rounded flex items-center justify-center text-gray-400 dark:text-zinc-500 hover:text-indigo-500 hover:bg-indigo-500/10 transition-colors shrink-0"
            title="Run eval"
          >
            <Play className="h-3.5 w-3.5" />
          </button>
        )}

        <ChevronDown
          onClick={onToggle}
          className={cn('h-4 w-4 text-gray-400 dark:text-zinc-500 transition-transform cursor-pointer shrink-0', expandedProp && 'rotate-180')}
        />
      </div>

      {expandedProp && (
        <div className="border-t border-gray-100 dark:border-zinc-800/50 px-4 py-3 bg-gray-50/50 dark:bg-zinc-900/30 space-y-3">
          {/* Query */}
          <div>
            <div className="text-[10px] font-semibold text-gray-400 dark:text-zinc-500 uppercase tracking-widest mb-1">Query</div>
            <div className="text-xs text-gray-700 dark:text-zinc-300 bg-white dark:bg-zinc-800/50 border border-gray-200 dark:border-zinc-700/50 rounded px-3 py-2 font-mono break-words">
              {suite.query}
            </div>
          </div>

          {/* Assertions */}
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

          {/* Result detail (when available) */}
          {isDone && cardResult.error && (
            <div className="text-xs text-red-400 bg-red-500/5 border border-red-500/20 rounded px-3 py-2 font-mono">
              {cardResult.error}
            </div>
          )}

          {isDone && cardResult.result && (
            <>
              {/* Response */}
              {cardResult.result.response && (
                <div>
                  <div className="text-[10px] font-semibold text-gray-400 dark:text-zinc-500 uppercase tracking-widest mb-1">Response</div>
                  <div className="text-xs text-gray-700 dark:text-zinc-300 bg-white dark:bg-zinc-800/50 border border-gray-200 dark:border-zinc-700/50 rounded px-3 py-2 max-h-48 overflow-y-auto whitespace-pre-wrap break-words">
                    {cardResult.result.response}
                  </div>
                </div>
              )}

              {/* Tool calls */}
              {cardResult.result.toolCalls.length > 0 && (
                <div>
                  <div className="text-[10px] font-semibold text-gray-400 dark:text-zinc-500 uppercase tracking-widest mb-1">Tool Calls</div>
                  <div className="space-y-1">
                    {cardResult.result.toolCalls.map((tc, ti) => (
                      <div key={ti} className="text-xs px-2 py-1 rounded bg-gray-100 dark:bg-zinc-800/40 font-mono break-words">
                        <span className="text-indigo-500 font-semibold">{tc.name}</span>
                        {cardResult.result?.toolResults?.[ti] && (
                          <div className="mt-1 text-gray-500 dark:text-zinc-500 text-[10px]">
                            <CollapsibleText text={cardResult.result.toolResults[ti]} />
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Assertion results */}
              {cardResult.result.assertions.length > 0 && (
                <div>
                  <div className="text-[10px] font-semibold text-gray-400 dark:text-zinc-500 uppercase tracking-widest mb-1">Judge Assessment</div>
                  <div className="space-y-1.5">
                    {cardResult.result.assertions.map((a, ai) => (
                      <div key={ai} className={cn('text-xs rounded px-3 py-2 border', a.passed ? 'border-emerald-500/20 bg-emerald-500/5' : 'border-red-500/20 bg-red-500/5')}>
                        <div className="flex items-center gap-2">
                          {a.passed ? (
                            <CheckCircle2 className="h-3 w-3 text-emerald-400 shrink-0" />
                          ) : (
                            <XCircle className="h-3 w-3 text-red-400 shrink-0" />
                          )}
                          <span className={a.passed ? 'text-emerald-300' : 'text-red-300'}>{a.negated ? 'NOT ' : ''}{a.text}</span>
                        </div>
                        {a.reason && (
                          <div className="mt-1 ml-5 text-gray-500 dark:text-zinc-500 italic break-words whitespace-normal">{a.reason}</div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Cost breakdown */}
              {(cardResult.result.queryCost || cardResult.result.judgeCost) && (
                <div className="flex gap-4 text-[11px] text-gray-400 dark:text-zinc-500">
                  {cardResult.result.queryCost && (
                    <span>Query: {formatCost(cardResult.result.queryCost.estimatedCostMicros)} ({cardResult.result.queryCost.inputTokens + cardResult.result.queryCost.outputTokens} tokens)</span>
                  )}
                  {cardResult.result.judgeCost && (
                    <span>Judge: {formatCost(cardResult.result.judgeCost.estimatedCostMicros)}</span>
                  )}
                </div>
              )}
            </>
          )}

          {/* History */}
          {history.length > 0 && (
            <div>
              <button
                onClick={() => setHistoryOpen(!historyOpen)}
                className="flex items-center gap-1 text-[10px] font-semibold text-gray-400 dark:text-zinc-500 uppercase tracking-widest hover:text-gray-600 dark:hover:text-zinc-400"
              >
                <ChevronDown className={cn('h-3 w-3 transition-transform', historyOpen && 'rotate-180')} />
                History ({history.length})
              </button>
              {historyOpen && (
                <div className="mt-2 border border-gray-200 dark:border-zinc-800 rounded-lg overflow-hidden">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="bg-gray-50 dark:bg-zinc-900/50 text-gray-500 dark:text-zinc-500">
                        <th className="text-center px-3 py-1.5 font-medium">Result</th>
                        <th className="text-center px-3 py-1.5 font-medium">Assertions</th>
                        <th className="text-right px-3 py-1.5 font-medium">Time</th>
                        <th className="text-right px-3 py-1.5 font-medium">Cost</th>
                        <th className="text-right px-3 py-1.5 font-medium">When</th>
                      </tr>
                    </thead>
                    <tbody>
                      {history.map((h, i) => (
                        <tr key={i} className="border-t border-gray-100 dark:border-zinc-800/50">
                          <td className="px-3 py-1.5 text-center">
                            <span className={h.passed ? 'text-emerald-400' : 'text-red-400'}>{h.passed ? 'PASS' : 'FAIL'}</span>
                          </td>
                          <td className="px-3 py-1.5 text-center">
                            <span className="inline-flex items-center gap-0.5">
                              {h.assertions.map((a, ai) => (
                                <span key={ai} className={cn('inline-block w-1.5 h-1.5 rounded-full', a.passed ? 'bg-emerald-400' : 'bg-red-400')} />
                              ))}
                            </span>
                          </td>
                          <td className="px-3 py-1.5 text-right text-gray-400 dark:text-zinc-500">{formatDuration(h.durationMs)}</td>
                          <td className="px-3 py-1.5 text-right text-gray-400 dark:text-zinc-500 font-mono">{formatCost(h.queryCostMicros)}</td>
                          <td className="px-3 py-1.5 text-right text-gray-400 dark:text-zinc-500">{formatRelativeTime(h.timestamp)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Main Page                                                          */
/* ------------------------------------------------------------------ */

export function EvalSuitePage() {
  const [suites, setSuites] = useState<EvalSuite[]>([]);
  const [expandedSet, setExpandedSet] = useState<Set<string>>(new Set());
  const [runTrigger, setRunTrigger] = useState(0);
  const [historyMap, setHistoryMap] = useState<Record<string, EvalHistoryEntry[]>>({});

  const loadSuites = useCallback(() => {
    fetch('/api/evals/suites')
      .then((res) => res.json())
      .then((data: unknown) => {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- server response
        const d = data as { suites: EvalSuite[] };
        setSuites(d.suites);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    loadSuites();
  }, [loadSuites]);

  // Fetch per-eval history
  useEffect(() => {
    for (const suite of suites) {
      fetch(`/api/evals/runs/by-eval/${encodeURIComponent(suite.name)}`)
        .then((res) => res.json())
        .then((data: unknown) => {
          // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- server response
          const d = data as { entries: EvalHistoryEntry[] };
          setHistoryMap((prev) => ({ ...prev, [suite.name]: d.entries }));
        })
        .catch(() => {});
    }
  }, [suites]);

  const toggleCard = useCallback((name: string) => {
    setExpandedSet((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }, []);

  const expandAll = useCallback(() => {
    setExpandedSet(new Set(suites.map((s) => s.name)));
  }, [suites]);

  const collapseAll = useCallback(() => {
    setExpandedSet(new Set());
  }, []);

  const runAll = useCallback(() => {
    setRunTrigger((prev) => prev + 1);
  }, []);

  return (
    <div className="h-full flex flex-col bg-white dark:bg-[#0a0a0f]">
      {/* Header */}
      <div className="border-b border-gray-200 dark:border-zinc-800/50 px-6 py-4">
        <div className="flex items-center gap-2 mb-1">
          <FlaskConical className="h-5 w-5 text-indigo-500" />
          <h1 className="text-lg font-semibold text-gray-900 dark:text-zinc-200">Eval Suite</h1>
        </div>
        <p className="text-xs text-gray-400 dark:text-zinc-500 max-w-2xl">
          Run your eval cases against the configured model. Each eval sends a query to the agent and checks assertions with an LLM judge. Green means pass, red means fail. Add evals in the <code className="px-1 py-0.5 rounded bg-gray-100 dark:bg-zinc-800 text-[11px]">evals/</code> directory.
        </p>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto scrollbar-thin">
        <div className="max-w-4xl mx-auto px-6 py-6">
          {suites.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <FlaskConical className="h-12 w-12 text-indigo-500/20 mb-4" />
              <h3 className="text-sm font-semibold text-gray-400 dark:text-zinc-400 mb-2">No evals defined</h3>
              <p className="text-xs text-gray-400 dark:text-zinc-500 max-w-sm">
                Create eval files in the <code className="px-1 py-0.5 rounded bg-gray-100 dark:bg-zinc-800">evals/</code> directory. Each eval is a markdown file with a query and assertions.
              </p>
            </div>
          ) : (
            <>
              <div className="flex items-center gap-3 mb-4">
                <button
                  onClick={runAll}
                  className="px-4 py-2 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-500 transition-colors flex items-center gap-2"
                >
                  <Play className="h-3.5 w-3.5" />
                  Run All
                </button>
                <div className="flex items-center gap-2 text-[11px]">
                  <button onClick={expandAll} className="text-indigo-400 hover:text-indigo-300 transition-colors">expand all</button>
                  <span className="text-gray-300 dark:text-zinc-700">/</span>
                  <button onClick={collapseAll} className="text-indigo-400 hover:text-indigo-300 transition-colors">collapse all</button>
                </div>
              </div>
              <div className="space-y-2">
                {suites.map((suite) => (
                  <EvalCard
                    key={suite.name}
                    suite={suite}
                    expanded={expandedSet.has(suite.name)}
                    onToggle={() => toggleCard(suite.name)}
                    runTrigger={runTrigger}
                    history={historyMap[suite.name] ?? []}
                  />
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
