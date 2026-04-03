/**
 * @license
 * Copyright 2025 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import React, { useEffect, useState, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import { Play, Loader2, ExternalLink, AlertTriangle, LayoutDashboard } from 'lucide-react';

interface PageInfo {
  name: string;
  description?: string;
  stores?: string[];
  automations?: string[];
}

interface AutomationStatus {
  name: string;
  running: boolean;
  schedule?: string;
}

function DataSourceBar({ pageInfo }: { pageInfo: PageInfo }) {
  const [automations, setAutomations] = useState<AutomationStatus[]>([]);
  const [runningNames, setRunningNames] = useState<Set<string>>(new Set());
  const [togglingNames, setTogglingNames] = useState<Set<string>>(new Set());

  const fetchAutomations = useCallback(() => {
    if (!pageInfo.automations?.length) return;
    fetch('/automations')
      .then((res) => res.json())
      .then((data: unknown) => {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- server response
        const d = data as { automations: AutomationStatus[] };
        const relevant = (d.automations || []).filter((a) => pageInfo.automations!.includes(a.name));
        setAutomations(relevant);
      })
      .catch(() => {});
  }, [pageInfo.automations]);

  useEffect(() => {
    fetchAutomations();
  }, [fetchAutomations]);

  const handleToggle = useCallback((name: string, currentlyRunning: boolean) => {
    setTogglingNames((prev) => new Set([...prev, name]));
    const action = currentlyRunning ? 'stop' : 'start';
    fetch(`/automations/${encodeURIComponent(name)}/${action}`, { method: 'POST' })
      .then(() => fetchAutomations())
      .catch(() => {})
      .finally(() => setTogglingNames((prev) => { const next = new Set(prev); next.delete(name); return next; }));
  }, [fetchAutomations]);

  const handleRun = useCallback((name: string) => {
    setRunningNames((prev) => new Set([...prev, name]));
    fetch(`/automations/${encodeURIComponent(name)}/run`, { method: 'POST' })
      .then(() => {
        setTimeout(() => setRunningNames((prev) => { const next = new Set(prev); next.delete(name); return next; }), 5000);
      })
      .catch(() => setRunningNames((prev) => { const next = new Set(prev); next.delete(name); return next; }));
  }, []);

  const hasStores = pageInfo.stores && pageInfo.stores.length > 0;
  const hasAutomations = automations.length > 0;
  if (!hasStores && !hasAutomations) return null;

  // Build rows: pair each automation with its store if names overlap, otherwise show separately
  const rows: Array<{ store?: string; auto?: AutomationStatus; scheduleLabel?: string }> = [];

  // Match automations to stores by position, then add any extras
  const usedStores = new Set<string>();
  for (const auto of automations) {
    // Try to find a matching store (by name similarity)
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
  // Any remaining stores without automations
  for (const store of pageInfo.stores ?? []) {
    if (!usedStores.has(store)) rows.push({ store });
  }

  return (
    <div className="border-b border-gray-200 dark:border-zinc-800/50 bg-gray-50/50 dark:bg-zinc-900/30 px-4 py-2 text-xs">
      <div className="grid gap-y-1.5 gap-x-4 w-fit" style={{ gridTemplateColumns: 'auto auto auto auto auto' }}>
        {/* Header */}
        <span className="text-[10px] font-semibold text-gray-400 dark:text-zinc-600 uppercase tracking-widest">Store</span>
        <span className="text-[10px] font-semibold text-gray-400 dark:text-zinc-600 uppercase tracking-widest">Automation</span>
        <span className="text-[10px] font-semibold text-gray-400 dark:text-zinc-600 uppercase tracking-widest">Status</span>
        <span className="text-[10px] font-semibold text-gray-400 dark:text-zinc-600 uppercase tracking-widest">Schedule</span>
        <span />

        {rows.map((row, i) => {
          const isRunning = row.auto ? runningNames.has(row.auto.name) : false;
          return (
            <React.Fragment key={i}>
              {/* Store */}
              <div>
                {row.store ? (
                  <Link
                    to={`/entities/${row.store}`}
                    className="flex items-center gap-1 text-primary hover:text-primary dark:hover:text-primary/70 transition-colors"
                  >
                    {row.store}
                    <ExternalLink className="h-2.5 w-2.5" />
                  </Link>
                ) : (
                  <span className="text-gray-300 dark:text-zinc-700">-</span>
                )}
              </div>

              {/* Automation */}
              <div>
                {row.auto ? (
                  <Link
                    to={`/automations/${row.auto.name}`}
                    className="text-gray-500 dark:text-zinc-400 hover:text-gray-700 dark:hover:text-zinc-300 transition-colors"
                  >
                    {row.auto.name}
                  </Link>
                ) : (
                  <span className="text-gray-300 dark:text-zinc-700">-</span>
                )}
              </div>

              {/* Toggle */}
              <div>
                {row.auto ? (
                  <button
                    onClick={() => handleToggle(row.auto!.name, row.auto!.running)}
                    disabled={togglingNames.has(row.auto.name)}
                    className={`text-[10px] px-1.5 py-0.5 rounded cursor-pointer transition-colors ${row.auto.running ? 'bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20' : 'bg-zinc-500/10 text-zinc-500 hover:bg-zinc-500/20'}`}
                    title={row.auto.running ? 'Click to pause' : 'Click to start'}
                  >
                    {togglingNames.has(row.auto.name) ? '...' : row.auto.running ? 'live' : 'paused'}
                  </button>
                ) : <span />}
              </div>

              {/* Schedule */}
              <div className="text-gray-400 dark:text-zinc-600">
                {row.scheduleLabel || '-'}
              </div>

              {/* Run */}
              <div>
                {row.auto ? (
                  <button
                    onClick={() => handleRun(row.auto!.name)}
                    disabled={isRunning}
                    className="flex items-center gap-1 px-2 py-0.5 rounded bg-primary/10 text-primary hover:bg-primary/20 transition-colors disabled:opacity-40"
                  >
                    {isRunning ? <Loader2 className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />}
                    {isRunning ? 'Run' : 'Run'}
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

/**
 * Developer page loader.
 *
 * Loads pre-built page bundles from /pages-bundle/{name}.js via a script tag.
 * The page registers itself on window.__AMODAL_PAGES__[name].
 * React is available on window.React (set by the SPA entry point).
 */
export function DevPage() {
  const { pageName } = useParams<{ pageName: string }>();
  const [PageComponent, setPageComponent] = useState<React.ComponentType | null>(null);
  const [pageInfo, setPageInfo] = useState<PageInfo | null>(null);
  const [error, setError] = useState(false);

  // Fetch page metadata
  useEffect(() => {
    if (!pageName) return;
    fetch('/api/pages')
      .then((res) => res.json())
      .then((data: unknown) => {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- server response
        const d = data as { pages: PageInfo[] };
        const info = (d.pages || []).find((p) => p.name === pageName);
        if (info) setPageInfo(info);
      })
      .catch(() => {});
  }, [pageName]);

  useEffect(() => {
    if (!pageName) return;
    setPageComponent(null);
    setError(false);

    // Check if already loaded
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- Global page registry
    const registry = (window as unknown as Record<string, unknown>)['__AMODAL_PAGES__'] as Record<string, React.ComponentType> | undefined;
    if (registry?.[pageName]) {
      setPageComponent(() => registry[pageName]);
      return;
    }

    // Load via script tag
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

  if (error) {
    return <PageNotFound name={pageName ?? ''} />;
  }

  if (!PageComponent) {
    return <div className="p-6 text-gray-500 dark:text-zinc-500 text-sm">Loading page...</div>;
  }

  return (
    <div className="flex flex-col h-full border-t-2 border-primary/40">
      {/* Custom page header */}
      <div className="flex items-center gap-2 px-4 py-1.5 bg-primary/[0.03] border-b border-gray-200 dark:border-zinc-800/50">
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
            <h2 className="text-lg font-semibold text-gray-900 dark:text-zinc-200">Page Error</h2>
          </div>
          <p className="text-sm text-gray-500 dark:text-zinc-400 mb-3">
            The page <code className="px-1.5 py-0.5 rounded bg-gray-100 dark:bg-zinc-800 text-xs">{this.props.pageName}</code> threw an error during rendering.
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
      <h1 className="text-xl font-bold mb-2 text-gray-900 dark:text-zinc-200">Page Not Found</h1>
      <p className="text-gray-500 dark:text-zinc-500">
        {name
          ? `No page named "${name}" found in pages/.`
          : 'No page specified.'}
      </p>
    </div>
  );
}
