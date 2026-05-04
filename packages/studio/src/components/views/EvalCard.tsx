/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import { Fragment, useEffect, useState, useCallback, useRef } from 'react';
import { CheckCircle2, XCircle, FlaskConical, Loader2, ChevronDown } from 'lucide-react';
import { runtimeApiUrl } from '@/lib/api';
import { cn } from '@/lib/utils';

/* ------------------------------------------------------------------ */
/*  Types                                                               */
/* ------------------------------------------------------------------ */

export interface EvalSuite {
  name: string;
  title: string;
  description: string;
  query: string;
  assertionCount: number;
  assertions: Array<{ text: string; negated: boolean }>;
}

export interface AvailableModel {
  provider: string;
  model: string;
  label?: string;
}

export interface AssertionResult {
  text: string;
  negated: boolean;
  passed: boolean;
  reason: string;
}

export interface CostInfo {
  estimatedCostMicros: number;
  estimatedCostNoCacheMicros?: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadInputTokens?: number;
  cacheCreationInputTokens?: number;
}

export interface EvalResultDetail {
  response: string;
  toolCalls: Array<{ name: string; parameters: Record<string, unknown> }>;
  toolResults?: string[];
  assertions: AssertionResult[];
  durationMs: number;
  error?: string;
  queryCost?: CostInfo;
  judgeCost?: CostInfo;
}

export interface EvalHistoryEntry {
  runId: string;
  passed: boolean;
  durationMs: number;
  queryCostMicros: number;
  judgeCostMicros: number;
  timestamp: string;
  model: string;
  assertions: Array<{ passed: boolean }>;
}

export interface CompareResult {
  model: AvailableModel;
  passed: boolean;
  assertions: AssertionResult[];
  durationMs: number;
  queryCostMicros: number;
  judgeCostMicros: number;
  response: string;
  toolCalls: Array<{ name: string; parameters: Record<string, unknown> }>;
  toolResults: string[];
  error?: string;
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

function gradientColor(value: number, min: number, max: number): string {
  if (min === max) return 'text-emerald-400';
  const ratio = (value - min) / (max - min);
  if (ratio <= 0.33) return 'text-emerald-400';
  if (ratio <= 0.66) return 'text-amber-400';
  return 'text-red-400';
}

/* ------------------------------------------------------------------ */
/*  SSE helper                                                          */
/* ------------------------------------------------------------------ */

export function streamEvalRun(
  evalNames: string[],
  onEvent: (event: Record<string, unknown>) => void,
  model?: { provider: string; model: string },
  timeoutMs?: number,
): { promise: Promise<void>; abort: () => void } {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;

  if (timeoutMs) {
    timer = setTimeout(() => controller.abort(), timeoutMs);
  }

  const promise = (async () => {
    try {
      const resp = await fetch(runtimeApiUrl('/api/evals/run'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ evalNames, ...(model ? { model } : {}) }),
        signal: controller.signal,
      });
      if (!resp.ok || !resp.body) return;

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
            if (parsed && typeof parsed === 'object') {
              // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- SSE parsing at system boundary
              onEvent(parsed as Record<string, unknown>);
            }
          } catch { /* skip malformed SSE lines */ }
        }
      }
    } catch (err) {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- error classification at system boundary
      if ((err as Error).name !== 'AbortError') {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- error classification at system boundary
        onEvent({ type: 'error', message: (err as Error).message ?? 'Stream error' });
      }
    } finally {
      if (timer) clearTimeout(timer);
    }
  })();

  return { promise, abort: () => controller.abort() };
}

export async function runSingleModelEval(
  evalName: string,
  model: AvailableModel,
  timeoutMs?: number,
  onJudging?: () => void,
): Promise<CompareResult> {
  return new Promise<CompareResult>((resolve) => {
    let resolved = false;
    const result: CompareResult = {
      model,
      passed: false,
      assertions: [],
      durationMs: 0,
      queryCostMicros: 0,
      judgeCostMicros: 0,
      response: '',
      toolCalls: [],
      toolResults: [],
    };

    const { promise, abort } = streamEvalRun(
      [evalName],
      (event) => {
        const type = String(event['type'] ?? '');
        if (type === 'done' && !resolved) {
          // Query finished, judging begins
          onJudging?.();
        } else if (type === 'eval_complete' && !resolved) {
          resolved = true;
          // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- SSE result at system boundary
          const r = event['result'] as EvalResultDetail | undefined;
          if (r) {
            result.passed = Boolean(event['passed']);
            result.assertions = r.assertions ?? [];
            result.durationMs = r.durationMs ?? 0;
            result.queryCostMicros = r.queryCost?.estimatedCostMicros ?? 0;
            result.judgeCostMicros = r.judgeCost?.estimatedCostMicros ?? 0;
            result.response = r.response ?? '';
            result.toolCalls = r.toolCalls ?? [];
            result.toolResults = r.toolResults ?? [];
            result.error = r.error;
          }
        } else if (type === 'agent_error' && !resolved) {
          result.error = String(event['error'] ?? 'Unknown error');
        }
      },
      { provider: model.provider, model: model.model },
      timeoutMs,
    );

    const timeoutRace = timeoutMs
      ? new Promise<void>((_, reject) => setTimeout(() => reject(new Error('Timeout')), timeoutMs + 1000))
      : null;

    const race = timeoutRace
      ? Promise.race([promise, timeoutRace])
      : promise;

    race
      .then(() => {
        resolve(result);
      })
      .catch((err) => {
        if (!resolved) {
          resolved = true;
          // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- error message at system boundary
          result.error = (err as Error).message ?? 'Timeout';
          abort();
        }
        resolve(result);
      });
  });
}

/* ------------------------------------------------------------------ */
/*  CompareTable                                                        */
/* ------------------------------------------------------------------ */

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
        className="flex items-center gap-1 mt-1 text-[10px] text-primary hover:text-primary/70 transition-colors"
      >
        <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"
          className={cn('transition-transform', expanded && 'rotate-90')}>
          <polyline points="9 6 15 12 9 18" />
        </svg>
        {expanded ? 'collapse' : `show all (${text.length > 1000 ? Math.round(text.length / 1000) + 'K chars' : text.length + ' chars'})`}
      </button>
    </div>
  );
}

function ElapsedTimer({ startTime }: { startTime: number }) {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (!startTime) return;
    const interval = setInterval(() => setElapsed(Math.floor((Date.now() - startTime) / 1000)), 1000);
    return () => clearInterval(interval);
  }, [startTime]);
  return <span className="font-mono tabular-nums">{elapsed}s</span>;
}

export function CompareTable({ results, runningModel, runPhase, runStartTime }: { results: CompareResult[]; runningModel?: AvailableModel | null; runPhase?: 'querying' | 'judging'; runStartTime?: number }) {
  const [expandedRow, setExpandedRow] = useState<number | null>(null);

  if (results.length === 0 && !runningModel) return null;

  const times = results.map((r) => r.durationMs).filter((t) => t > 0);
  const costs = results.map((r) => r.queryCostMicros).filter((c) => c > 0);
  const minTime = Math.min(...times, Infinity);
  const maxTime = Math.max(...times, 0);
  const minCost = Math.min(...costs, Infinity);
  const maxCost = Math.max(...costs, 0);

  // Best value: cheapest passing model
  const passingCosts = results.filter((r) => r.passed).map((r) => r.queryCostMicros);
  const bestCost = passingCosts.length > 0 ? Math.min(...passingCosts) : -1;

  return (
    <div className="border border-border rounded-lg overflow-hidden">
      <table className="w-full text-sm table-fixed">
        <thead>
          <tr className="bg-card text-xs text-muted-foreground">
            <th className="text-left px-4 py-2 font-medium">Model</th>
            <th className="text-center px-4 py-2 font-medium">Result</th>
            <th className="text-center px-4 py-2 font-medium">Assertions</th>
            <th className="text-right px-4 py-2 font-medium">Time</th>
            <th className="text-right px-4 py-2 font-medium">Cost</th>
          </tr>
        </thead>
        <tbody>
          {results.map((r, i) => {
            const isExpanded = expandedRow === i;
            const isAuthError = r.error && /auth|unauthorized|401/i.test(r.error);
            const isRateLimit = r.error && /rate.?limit|429|too many/i.test(r.error);
            const errorColor = isAuthError ? 'text-amber-400' : isRateLimit ? 'text-orange-400' : 'text-red-400';
            const passedCount = r.assertions.filter((a) => a.passed).length;
            const isBest = r.passed && r.queryCostMicros === bestCost && bestCost >= 0;

            return (
              <Fragment key={i}>
                <tr
                  onClick={() => setExpandedRow(isExpanded ? null : i)}
                  className="border-t border-border hover:bg-muted/50 cursor-pointer"
                >
                  <td className="px-4 py-2.5 text-foreground font-medium">
                    {r.model.label || r.model.model.replace(/-\d{8}$/, '')}
                    {isBest && (
                      <span className="ml-2 px-1.5 py-0.5 text-[9px] font-semibold bg-emerald-500/10 text-emerald-400 rounded">best value</span>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-center">
                    {r.error ? (
                      <span className={cn('font-semibold text-xs', errorColor)}>ERR</span>
                    ) : r.passed ? (
                      <span className="font-semibold text-xs text-emerald-400">PASS</span>
                    ) : (
                      <span className="font-semibold text-xs text-red-400">FAIL</span>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-center">
                    <span className="inline-flex items-center gap-0.5">
                      {r.assertions.map((a, ai) => (
                        <span key={ai} className={cn('inline-block w-1.5 h-1.5 rounded-full', a.passed ? 'bg-emerald-400' : 'bg-red-400')} />
                      ))}
                      {r.assertions.length > 0 && (
                        <span className="text-[10px] text-muted-foreground ml-1">
                          {passedCount}/{r.assertions.length}
                        </span>
                      )}
                    </span>
                  </td>
                  <td className={cn('px-4 py-2.5 text-right font-mono text-xs', r.durationMs > 0 ? gradientColor(r.durationMs, minTime, maxTime) : 'text-muted-foreground')}>
                    {r.durationMs > 0 ? formatDuration(r.durationMs) : '-'}
                  </td>
                  <td className={cn('px-4 py-2.5 text-right font-mono text-xs', r.queryCostMicros > 0 ? gradientColor(r.queryCostMicros, minCost, maxCost) : 'text-muted-foreground')}>
                    {r.queryCostMicros > 0 ? formatCost(r.queryCostMicros) : '-'}
                  </td>
                </tr>
                {isExpanded && (
                  <tr className="border-t border-border">
                    <td colSpan={5} className="px-4 py-3 bg-muted/50 space-y-3" style={{overflowWrap: 'anywhere', wordBreak: 'break-word'}}>
                      {r.error && (
                        <div className={cn('text-xs border rounded px-3 py-2 font-mono',
                          isAuthError ? 'text-amber-400 bg-amber-500/5 border-amber-500/20' :
                          isRateLimit ? 'text-orange-400 bg-orange-500/5 border-orange-500/20' :
                          'text-red-400 bg-red-500/5 border-red-500/20',
                        )}>
                          {r.error}
                        </div>
                      )}
                      <div>
                        <div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest mb-1">Response</div>
                        <div className="text-xs text-foreground bg-card border border-border rounded px-3 py-2 max-h-48 overflow-y-auto whitespace-pre-wrap break-words">
                          {r.response || <span className="text-muted-foreground italic">(empty response)</span>}
                        </div>
                      </div>
                      {r.toolCalls.length > 0 && (
                        <div>
                          <div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest mb-1">Tool Calls</div>
                          <div className="space-y-1">
                            {r.toolCalls.map((tc, ti) => (
                              <div key={ti} className="text-xs px-2 py-1 rounded bg-muted font-mono break-words">
                                <span className="text-primary font-semibold">{tc.name}</span>
                                {r.toolResults[ti] && (
                                  <div className="mt-1 text-muted-foreground text-[10px]">
                                    <CollapsibleText text={r.toolResults[ti]} />
                                  </div>
                                )}
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                      {r.assertions.length > 0 && (
                        <div>
                          <div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest mb-1">Assertions</div>
                          <div className="space-y-1.5">
                            {r.assertions.map((a, ai) => (
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
                                  <div className="mt-1 ml-5 text-muted-foreground italic break-words whitespace-normal">{a.reason}</div>
                                )}
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
          {runningModel && (
            <tr>
              <td colSpan={6} className="px-3 py-2.5 border-t border-border">
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
                  <span className="text-foreground">{runningModel.label || runningModel.model.replace(/-\d{8}$/, '')}</span>
                  <span className={runPhase === 'judging' ? 'text-amber-400' : 'text-primary'}>
                    {runPhase === 'judging' ? 'judging' : 'running'}
                  </span>
                  {runStartTime ? <ElapsedTimer startTime={runStartTime} /> : null}
                </div>
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  EvalCard                                                            */
/* ------------------------------------------------------------------ */

export function EvalCard({
  suite,
  models,
  history,
  hideModelSelector,
  autoRunTrigger,
  expandOverride,
}: {
  suite: EvalSuite;
  models: AvailableModel[];
  history: EvalHistoryEntry[];
  hideModelSelector?: boolean;
  autoRunTrigger?: number;
  expandOverride?: boolean | null;
}) {
  const [expanded, setExpanded] = useState(false);
  const lastAutoRun = useRef(0);

  // Respond to parent expand all / collapse all
  useEffect(() => {
    if (expandOverride !== undefined && expandOverride !== null) {
      setExpanded(expandOverride);
    }
  }, [expandOverride]);
  const [selectedModels, setSelectedModels] = useState<Set<string>>(new Set());
  const [timeout, setTimeoutVal] = useState(60);
  const [isRunning, setIsRunning] = useState(false);
  const [currentRunningModel, setCurrentRunningModel] = useState<AvailableModel | null>(null);
  const [runPhase, setRunPhase] = useState<'querying' | 'judging'>('querying');
  const [runStartTime, setRunStartTime] = useState<number>(0);
  const [results, setResults] = useState<CompareResult[]>([]);
  const [historyOpen, setHistoryOpen] = useState(false);

  // Pre-select first model: immediately when hideModelSelector, otherwise on first expand
  useEffect(() => {
    if (selectedModels.size === 0 && models.length > 0 && (hideModelSelector || expanded)) {
      setSelectedModels(new Set([`${models[0].provider}/${models[0].model}`]));
    }
  }, [expanded, models, selectedModels.size, hideModelSelector]);

  const toggleModel = (key: string) => {
    setSelectedModels((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const selectAll = () => {
    setSelectedModels(new Set(models.map((m) => `${m.provider}/${m.model}`)));
  };

  const selectNone = () => {
    setSelectedModels(new Set());
  };

  const handleRun = useCallback(async () => {
    setIsRunning(true);
    setResults([]);

    const selected = models.filter((m) => selectedModels.has(`${m.provider}/${m.model}`));

    // Run sequentially, each model result appears in table as it completes
    for (const model of selected) {
      setCurrentRunningModel(model);
      setRunPhase('querying');
      setRunStartTime(Date.now());
      const r = await runSingleModelEval(suite.name, model, timeout * 1000, () => {
        setRunPhase('judging');
        setRunStartTime(Date.now());
      });
      setResults((prev) => [...prev, r]);
    }

    setCurrentRunningModel(null);
    setIsRunning(false);
  }, [suite.name, timeout, models, selectedModels]);

  // Auto-run when triggered by parent (e.g., Run All)
  useEffect(() => {
    if (autoRunTrigger && autoRunTrigger > 0 && autoRunTrigger !== lastAutoRun.current && !isRunning && selectedModels.size > 0) {
      lastAutoRun.current = autoRunTrigger;
      void handleRun();
    }
  }, [autoRunTrigger, isRunning, selectedModels.size, handleRun]);

  const selectedCount = selectedModels.size;
  const colCount = Math.min(Math.max(models.length, 3), 5);

  // Determine overall pass/fail from results (for suite mode styling)
  const allPassed = results.length > 0 && results.every((r) => r.passed && !r.error);
  const anyFailed = results.length > 0 && results.some((r) => !r.passed || r.error);
  const hasSuiteResult = hideModelSelector && results.length > 0 && !isRunning;

  const borderColor = hasSuiteResult
    ? allPassed ? 'border-emerald-500/40' : 'border-red-500/40'
    : 'border-border';

  // Icon: spinner when running, green/red beaker in suite mode with results, default otherwise
  let headerIcon = <FlaskConical className="h-4 w-4 text-primary/60 shrink-0" />;
  if (isRunning) {
    headerIcon = <Loader2 className="h-4 w-4 animate-spin text-primary shrink-0" />;
  } else if (hasSuiteResult && allPassed) {
    headerIcon = <FlaskConical className="h-4 w-4 text-emerald-400 shrink-0" />;
  } else if (hasSuiteResult && anyFailed) {
    headerIcon = <FlaskConical className="h-4 w-4 text-red-400 shrink-0" />;
  }

  return (
    <div className={cn('border rounded-lg overflow-hidden transition-colors', borderColor)}>
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-muted transition-colors"
      >
        {headerIcon}
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium text-foreground">{suite.title || suite.name}</div>
          {suite.description && (
            <div className="text-xs text-muted-foreground truncate">{suite.description}</div>
          )}
        </div>
        <span className="text-[11px] text-muted-foreground tabular-nums">
          {suite.assertionCount} assertion{suite.assertionCount !== 1 ? 's' : ''}
        </span>
        <ChevronDown className={cn('h-4 w-4 text-muted-foreground transition-transform', expanded && 'rotate-180')} />
      </button>

      {expanded && (
        <div className="border-t border-border px-4 py-3 bg-muted space-y-4">
          {/* Query */}
          <div>
            <div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest mb-1">Query</div>
            <div className="text-sm text-foreground bg-card border border-border rounded px-3 py-2 font-mono break-words">
              {suite.query}
            </div>
          </div>

          {/* Assertions */}
          <div>
            <div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest mb-1">Assertions</div>
            <div className="space-y-1">
              {suite.assertions.map((a, i) => (
                <div key={i} className="flex items-center gap-2 text-xs text-muted-foreground">
                  <span className={a.negated ? 'text-red-400' : 'text-emerald-400'}>{a.negated ? 'NOT' : 'SHOULD'}</span>
                  <span>{a.text}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Model selector grid */}
          {!hideModelSelector && (
            <div>
              <div className="flex items-center gap-2 mb-2">
                <div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest">Models</div>
                <button onClick={selectAll} className="text-[10px] text-primary hover:text-primary/70">all</button>
                <button onClick={selectNone} className="text-[10px] text-primary hover:text-primary/70">none</button>
              </div>
              <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${colCount}, minmax(0, 1fr))` }}>
                {models.map((m) => {
                  const key = `${m.provider}/${m.model}`;
                  const isSelected = selectedModels.has(key);
                  return (
                    <button
                      key={key}
                      onClick={() => toggleModel(key)}
                      className={cn(
                        'px-2 py-1.5 rounded text-xs font-medium border transition-colors text-center truncate',
                        isSelected
                          ? 'border-primary/50 bg-primary/10 text-primary'
                          : 'border-border text-muted-foreground hover:border-primary/30',
                      )}
                    >
                      {m.label || m.model.replace(/-\d{8}$/, '')}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Timeout slider */}
          {!hideModelSelector && (
            <div className="flex items-center gap-3">
              <div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest">Timeout</div>
              <input
                type="range"
                min={20}
                max={300}
                value={timeout}
                onChange={(e) => setTimeoutVal(Number(e.target.value))}
                className="flex-1 h-1 accent-blue-600"
              />
              <span className="text-xs text-muted-foreground tabular-nums w-10 text-right">{timeout}s</span>
            </div>
          )}

          {/* Run button */}
          <button
            onClick={() => { void handleRun(); }}
            disabled={isRunning || selectedCount === 0}
            className="px-4 py-2 rounded-lg bg-primary-solid text-white text-sm font-medium hover:bg-primary-solid/90 disabled:opacity-30 transition-colors flex items-center gap-2"
          >
            {isRunning ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Run {selectedCount} model{selectedCount !== 1 ? 's' : ''}
          </button>

          {/* Results table */}
          <CompareTable results={results} runningModel={currentRunningModel} runPhase={runPhase} runStartTime={runStartTime} />

          {/* History */}
          {history.length > 0 && (
            <div>
              <button
                onClick={() => setHistoryOpen(!historyOpen)}
                className="flex items-center gap-1 text-[10px] font-semibold text-muted-foreground uppercase tracking-widest hover:text-foreground"
              >
                <ChevronDown className={cn('h-3 w-3 transition-transform', historyOpen && 'rotate-180')} />
                History ({history.length})
              </button>
              {historyOpen && (
                <div className="mt-2 border border-border rounded-lg overflow-hidden">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="bg-card text-muted-foreground">
                        <th className="text-left px-3 py-1.5 font-medium">Model</th>
                        <th className="text-center px-3 py-1.5 font-medium">Result</th>
                        <th className="text-center px-3 py-1.5 font-medium">Assertions</th>
                        <th className="text-right px-3 py-1.5 font-medium">Time</th>
                        <th className="text-right px-3 py-1.5 font-medium">Cost</th>
                        <th className="text-right px-3 py-1.5 font-medium">When</th>
                      </tr>
                    </thead>
                    <tbody>
                      {history.map((h, i) => (
                        <tr key={i} className="border-t border-border">
                          <td className="px-3 py-1.5 text-foreground">{h.model.replace(/-\d{8}$/, '')}</td>
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
                          <td className="px-3 py-1.5 text-right text-muted-foreground">{formatDuration(h.durationMs)}</td>
                          <td className="px-3 py-1.5 text-right text-muted-foreground font-mono">{formatCost(h.queryCostMicros)}</td>
                          <td className="px-3 py-1.5 text-right text-muted-foreground">{formatRelativeTime(h.timestamp)}</td>
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
