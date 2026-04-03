/**
 * @license
 * Copyright 2025 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import { useCallback, useEffect, useState } from 'react';
import { Zap, Play, Clock, CheckCircle2, XCircle, Loader2 } from 'lucide-react';
import { CronExpressionParser } from 'cron-parser';
import cronstrue from 'cronstrue';

interface AutomationInfo {
  name: string;
  title: string;
  prompt: string;
  schedule?: string;
  trigger: string;
  running: boolean;
  lastRun?: string;
  lastRunStatus?: 'success' | 'error';
  lastRunError?: string;
  lastRunSessionId?: string;
}

function estimateNextRun(schedule: string): string | null {
  const interval = CronExpressionParser.parse(schedule);
  const next = interval.next().toDate();
  const diffMs = next.getTime() - Date.now();
  const mins = Math.floor(diffMs / 60_000);
  if (mins < 1) return 'less than 1m';
  if (mins < 60) return `${String(mins)}m`;
  const hours = Math.floor(mins / 60);
  const remainMins = mins % 60;
  if (hours < 24) return remainMins > 0 ? `${String(hours)}h ${String(remainMins)}m` : `${String(hours)}h`;
  const days = Math.floor(hours / 24);
  return `${String(days)}d`;
}

function formatRelative(ts: string): string {
  const diff = Date.now() - new Date(ts).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${String(mins)}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${String(hours)}h ago`;
  const days = Math.floor(hours / 24);
  return `${String(days)}d ago`;
}

export function AutomationsPage() {
  const [automations, setAutomations] = useState<AutomationInfo[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [runningNames, setRunningNames] = useState<Set<string>>(new Set());

  const fetchAutomations = useCallback(async () => {
    try {
      const res = await fetch('/automations');
      if (res.ok) {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- Server response
        const body = await res.json() as { automations: AutomationInfo[] };
        setAutomations(body.automations);
      }
    } catch {
      // endpoint may not exist
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchAutomations();
  }, [fetchAutomations]);

  const handleRunNow = useCallback(async (name: string) => {
    setRunningNames((prev) => new Set([...prev, name]));
    try {
      await fetch(`/automations/${encodeURIComponent(name)}/run`, { method: 'POST' });
    } catch {
      // error handled by server
    } finally {
      setRunningNames((prev) => {
        const next = new Set(prev);
        next.delete(name);
        return next;
      });
      void fetchAutomations();
    }
  }, [fetchAutomations]);

  return (
    <div className="h-full bg-background">
      <div className="border-b border-border px-6 py-4">
        <h1 className="text-lg font-semibold text-foreground">Automations</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          {automations.length} automation{automations.length !== 1 ? 's' : ''} configured
        </p>
      </div>

      <div className="p-6 max-w-3xl">
        {isLoading ? (
          <div className="text-muted-foreground text-sm">Loading...</div>
        ) : automations.length === 0 ? (
          <div className="text-center py-12">
            <Zap className="h-8 w-8 text-gray-300 dark:text-zinc-700 mx-auto mb-3" />
            <p className="text-sm text-muted-foreground">
              No automations defined. Add <code className="text-xs bg-muted px-1.5 py-0.5 rounded">.json</code> files to <code className="text-xs bg-muted px-1.5 py-0.5 rounded">automations/</code>.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {automations.map((auto) => {
              const isRunning = runningNames.has(auto.name);
              return (
                <div
                  key={auto.name}
                  className="border border-border rounded-xl p-5 bg-card"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <a href={`/automations/${encodeURIComponent(auto.name)}`} className="flex items-center gap-2 mb-1 hover:opacity-80 transition-opacity">
                        <Zap className="h-4 w-4 text-primary shrink-0" />
                        <h3 className="text-sm font-semibold text-foreground">{auto.title}</h3>
                      </a>

                      <div className="flex items-center gap-3 mb-3">
                        <span className="text-[11px] px-2 py-0.5 rounded-full bg-primary/10 dark:bg-primary/10 text-primary dark:text-primary font-medium">
                          {auto.trigger}
                        </span>
                        {auto.schedule && (
                          <>
                            <span className="flex items-center gap-1 text-xs text-muted-foreground">
                              <Clock className="h-3 w-3" />
                              {cronstrue.toString(auto.schedule, { use24HourTimeFormat: true })}
                            </span>
                            {(() => {
                              const next = estimateNextRun(auto.schedule);
                              return next ? (
                                <span className="text-xs text-muted-foreground">
                                  Next in {next}
                                </span>
                              ) : null;
                            })()}
                          </>
                        )}
                      </div>

                      <p className="text-xs text-muted-foreground leading-relaxed line-clamp-2">
                        {auto.prompt}
                      </p>

                      {auto.lastRun && (
                        <div className="flex items-center gap-2 mt-3 text-xs">
                          {auto.lastRunStatus === 'success' ? (
                            <CheckCircle2 className="h-3 w-3 text-emerald-500" />
                          ) : (
                            <XCircle className="h-3 w-3 text-red-400" />
                          )}
                          <span className="text-muted-foreground">
                            Last run {formatRelative(auto.lastRun)}
                            {auto.lastRunStatus === 'error' && auto.lastRunError && (
                              <span className="text-red-400 ml-1">— {auto.lastRunError}</span>
                            )}
                          </span>
                          {auto.lastRunSessionId && (
                            <a href={`/sessions/${auto.lastRunSessionId}`} className="text-xs text-primary hover:text-primary ml-2">
                              View session
                            </a>
                          )}
                        </div>
                      )}
                    </div>

                    <button
                      onClick={() => { void handleRunNow(auto.name); }}
                      disabled={isRunning}
                      className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-lg bg-primary-solid text-white hover:bg-primary-solid/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed shrink-0"
                    >
                      {isRunning ? (
                        <>
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          Running...
                        </>
                      ) : (
                        <>
                          <Play className="h-3.5 w-3.5" />
                          Run Now
                        </>
                      )}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
