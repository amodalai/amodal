/**
 * @license
 * Copyright 2025 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { useParams, Link } from 'react-router-dom';
import { Play, Loader2, ExternalLink, AlertTriangle, LayoutDashboard } from 'lucide-react';
import { useAutomations, useAutomationAction } from '@/hooks/useAutomations';
import { usePages } from '@/hooks/useRuntimeData';

interface PageInfo {
  name: string;
  description?: string;
  stores?: string[];
  automations?: string[];
}

function DataSourceBar({ pageInfo }: { pageInfo: PageInfo }) {
  const { data: allAutomations } = useAutomations();
  const actionMutation = useAutomationAction();
  const [runningNames, setRunningNames] = useState<Set<string>>(new Set());

  const automations = useMemo(
    () => allAutomations.filter((a) => pageInfo.automations?.includes(a.name)),
    [allAutomations, pageInfo.automations],
  );

  const handleToggle = useCallback((name: string, currentlyRunning: boolean) => {
    actionMutation.mutate({ name, action: currentlyRunning ? 'stop' : 'start' });
  }, [actionMutation]);

  const handleRun = useCallback((name: string) => {
    setRunningNames((prev) => new Set([...prev, name]));
    actionMutation.mutate({ name, action: 'run' }, {
      onSettled: () => {
        setTimeout(() => setRunningNames((prev) => { const next = new Set(prev); next.delete(name); return next; }), 5000);
      },
    });
  }, [actionMutation]);

  const hasStores = pageInfo.stores && pageInfo.stores.length > 0;
  const hasAutomations = automations.length > 0;
  if (!hasStores && !hasAutomations) return null;

  const rows: Array<{ store?: string; auto?: typeof automations[number]; scheduleLabel?: string }> = [];
  const usedStores = new Set<string>();
  for (const auto of automations) {
    const matchingStore = pageInfo.stores?.find((s) => !usedStores.has(s));
    if (matchingStore) usedStores.add(matchingStore);

    let scheduleLabel = auto.schedule ?? '';
    if (scheduleLabel) {
      const parts = scheduleLabel.split(' ');
      if (parts.length === 5) {
        const [min, hour] = parts;
        if (hour === '*' && min === '0') scheduleLabel = 'every hour';
        else if (hour?.startsWith('*/')) scheduleLabel = `every ${hour.slice(2)} hours`;
        else if (min === '0' && hour && !hour.includes('*') && !hour.includes('/')) scheduleLabel = `daily at ${hour}:00`;
        else if (parts[4] === '1-5' && min === '0') scheduleLabel = `weekdays at ${hour ?? '?'}:00`;
      }
    }
    rows.push({ store: matchingStore, auto, scheduleLabel });
  }
  for (const store of pageInfo.stores ?? []) {
    if (!usedStores.has(store)) rows.push({ store });
  }

  return (
    <div className="border-b border-border bg-muted px-4 py-2 text-xs">
      <div className="grid gap-y-1.5 gap-x-4 w-fit" style={{ gridTemplateColumns: 'auto auto auto auto auto' }}>
        <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest">Store</span>
        <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest">Automation</span>
        <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest">Status</span>
        <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest">Schedule</span>
        <span />

        {rows.map((row, i) => {
          const isRunning = row.auto ? runningNames.has(row.auto.name) : false;
          return (
            <React.Fragment key={i}>
              <div>
                {row.store ? (
                  <Link to={`/entities/${row.store}`} className="flex items-center gap-1 text-primary hover:text-primary dark:hover:text-primary/70 transition-colors">
                    {row.store}
                    <ExternalLink className="h-2.5 w-2.5" />
                  </Link>
                ) : (
                  <span className="text-gray-300 dark:text-zinc-700">-</span>
                )}
              </div>
              <div>
                {row.auto ? (
                  <Link to={`/automations/${row.auto.name}`} className="text-muted-foreground hover:text-foreground transition-colors">
                    {row.auto.name}
                  </Link>
                ) : (
                  <span className="text-gray-300 dark:text-zinc-700">-</span>
                )}
              </div>
              <div>
                {row.auto ? (
                  <button
                    onClick={() => handleToggle(row.auto!.name, row.auto!.active ?? false)}
                    disabled={actionMutation.isPending}
                    className={`text-[10px] px-1.5 py-0.5 rounded cursor-pointer transition-colors ${row.auto.active ? 'bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20' : 'bg-zinc-500/10 text-zinc-500 hover:bg-zinc-500/20'}`}
                    title={row.auto.active ? 'Click to pause' : 'Click to start'}
                  >
                    {row.auto.active ? 'live' : 'paused'}
                  </button>
                ) : <span />}
              </div>
              <div className="text-muted-foreground">{row.scheduleLabel || '-'}</div>
              <div>
                {row.auto ? (
                  <button
                    onClick={() => handleRun(row.auto!.name)}
                    disabled={isRunning}
                    className="flex items-center gap-1 px-2 py-0.5 rounded bg-primary/10 text-primary hover:bg-primary/20 transition-colors disabled:opacity-40"
                  >
                    {isRunning ? <Loader2 className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />}
                    Run
                  </button>
                ) : <span />}
              </div>
            </React.Fragment>
          );
        })}
      </div>
    </div>
  );
}

export function DevPage() {
  const { pageName } = useParams<{ pageName: string }>();
  const { data: allPages } = usePages();
  const [PageComponent, setPageComponent] = useState<React.ComponentType | null>(null);
  const [error, setError] = useState(false);

  const pageInfo = useMemo(
    () => allPages.find((p) => p.name === pageName) as PageInfo | undefined,
    [allPages, pageName],
  );

  useEffect(() => {
    if (!pageName) return;
    setPageComponent(null);
    setError(false);

    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- Global page registry
    const registry = (window as unknown as Record<string, unknown>)['__AMODAL_PAGES__'] as Record<string, React.ComponentType> | undefined;
    if (registry?.[pageName]) {
      setPageComponent(() => registry[pageName]);
      return;
    }

    const script = document.createElement('script');
    script.src = `/pages-bundle/${pageName}.js`;
    script.onload = () => {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- Global page registry
      const reg = (window as unknown as Record<string, unknown>)['__AMODAL_PAGES__'] as Record<string, React.ComponentType> | undefined;
      if (reg?.[pageName]) {
        setPageComponent(() => reg[pageName]);
      } else {
        setError(true);
      }
    };
    script.onerror = () => setError(true);
    document.head.appendChild(script);
  }, [pageName]);

  if (error) return <PageNotFound name={pageName ?? ''} />;
  if (!PageComponent) return <div className="p-6 text-muted-foreground text-sm">Loading page...</div>;

  return (
    <div className="flex flex-col h-full border-t-2 border-primary/40">
      <div className="flex items-center gap-2 px-4 py-1.5 bg-primary/[0.03] border-b border-border">
        <LayoutDashboard className="h-3 w-3 text-primary/50" />
        <span className="text-[10px] font-medium text-primary/60 uppercase tracking-widest">
          {pageInfo?.description ?? pageName}
        </span>
      </div>
      {pageInfo && (pageInfo.stores?.length || pageInfo.automations?.length) && (
        <DataSourceBar pageInfo={pageInfo} />
      )}
      <div className="flex-1 overflow-auto">
        <PageErrorBoundary pageName={pageName ?? ''}>
          <PageComponent />
        </PageErrorBoundary>
      </div>
    </div>
  );
}

class PageErrorBoundary extends React.Component<
  { pageName: string; children: React.ReactNode },
  { hasError: boolean; error: Error | null }
> {
  constructor(props: { pageName: string; children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, error: null };
  }
  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }
  render() {
    if (this.state.hasError) {
      return (
        <div className="p-6 max-w-2xl">
          <div className="flex items-center gap-2 mb-3">
            <AlertTriangle className="h-5 w-5 text-amber-400" />
            <h2 className="text-lg font-semibold text-foreground">Page Error</h2>
          </div>
          <p className="text-sm text-muted-foreground mb-3">
            The page <code className="px-1.5 py-0.5 rounded bg-muted text-xs">{this.props.pageName}</code> threw an error during rendering.
          </p>
          <pre className="text-xs text-red-400 bg-red-500/5 border border-red-500/20 rounded-lg p-3 overflow-auto whitespace-pre-wrap">
            {this.state.error?.message ?? 'Unknown error'}
            {this.state.error?.stack && `\n\n${this.state.error.stack}`}
          </pre>
          <button
            onClick={() => this.setState({ hasError: false, error: null })}
            className="mt-3 px-3 py-1.5 rounded text-xs bg-primary/10 text-primary hover:bg-primary/20 transition-colors"
          >
            Try again
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

function PageNotFound({ name }: { name: string }) {
  return (
    <div className="p-6">
      <h1 className="text-xl font-bold mb-2 text-foreground">Page Not Found</h1>
      <p className="text-muted-foreground">
        {name ? `No page named "${name}" found in pages/.` : 'No page specified.'}
      </p>
    </div>
  );
}
