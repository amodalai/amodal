/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import {useEffect, useMemo, useState} from 'react';
import type {ReactNode} from 'react';
import {Link} from 'react-router-dom';
import {Activity, AlertCircle, ChevronDown, ChevronRight, ExternalLink, FileCode, KeyRound, Plug, RefreshCw} from 'lucide-react';
import type {LucideIcon} from 'lucide-react';
import {AgentOffline} from '@/components/AgentOffline';
import {runtimeApiUrl} from '@/lib/api';
import {useConnectionPackages} from '../hooks/useConnectionPackages';
import type {ConnectionPackage} from '../hooks/useConnectionPackages';
import {connectionConfigPath, connectionInspectPath} from '../lib/routes';

interface InspectConnectionStatus {
  name: string;
  status: 'connected' | 'error' | string;
  error?: string;
}

interface ConnectionFileSummary {
  name: string;
  path: string;
  files: string[];
  hasSpec: boolean;
  hasSurface: boolean;
  surfaceCount: number;
}

interface InspectContextResponse {
  connections?: InspectConnectionStatus[];
  connectionFiles?: ConnectionFileSummary[];
}

interface ConnectionEndpoint {
  method: string;
  path: string;
  description?: string;
}

interface RestConnectionDetail {
  name: string;
  kind: 'rest';
  spec?: {baseUrl?: string; format?: string; authType?: string};
  surface?: ConnectionEndpoint[];
  entities?: string | null;
  rules?: string | null;
  location?: string;
}

interface McpToolDetail {
  name: string;
  qualifiedName: string;
  description: string;
  parameters: Record<string, unknown>;
}

interface McpConnectionDetail {
  name: string;
  kind: 'mcp';
  status: string;
  error: string | null;
  transport: string;
  command: string | null;
  url: string | null;
  tools: McpToolDetail[];
  location?: string;
}

interface FileOnlyConnectionDetail {
  name: string;
  kind: 'files';
  status: string;
  files: string[];
  surface: ConnectionEndpoint[];
  location?: string;
}

type ConnectionDetail = RestConnectionDetail | McpConnectionDetail | FileOnlyConnectionDetail;

interface ConnectionRow {
  name: string;
  status: string;
  error?: string;
  loaded: boolean;
  file?: ConnectionFileSummary;
  pkg?: ConnectionPackage;
}

interface InspectContextState {
  data: InspectContextResponse | null;
  error: string | null;
  loading: boolean;
}

interface ConnectionDetailState {
  data: ConnectionDetail | null;
  error: string | null;
  loading: boolean;
}

function loadInspectContext(signal?: AbortSignal): Promise<InspectContextResponse> {
  return fetch(runtimeApiUrl('/inspect/context'), {
    signal: signal ?? AbortSignal.timeout(5_000),
  }).then((res) => {
    if (!res.ok) throw new Error(`Runtime returned ${String(res.status)}`);
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- system boundary: runtime inspect response
    return res.json() as Promise<InspectContextResponse>;
  });
}

function loadConnectionDetail(name: string, signal?: AbortSignal): Promise<ConnectionDetail> {
  return fetch(runtimeApiUrl(`/inspect/connections/${encodeURIComponent(name)}`), {
    signal: signal ?? AbortSignal.timeout(5_000),
  }).then((res) => {
    if (!res.ok) throw new Error(`Runtime returned ${String(res.status)}`);
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- system boundary: runtime inspect response
    return res.json() as Promise<ConnectionDetail>;
  });
}

function useInspectContext(refreshKey: number): InspectContextState {
  const [state, setState] = useState<InspectContextState>({data: null, error: null, loading: true});

  useEffect(() => {
    const controller = new AbortController();
    setState((current) => ({...current, error: null, loading: true}));
    loadInspectContext(controller.signal)
      .then((data) => setState({data, error: null, loading: false}))
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        setState({data: null, error: err instanceof Error ? err.message : String(err), loading: false});
      });
    return () => controller.abort();
  }, [refreshKey]);

  return state;
}

function useConnectionDetail(name: string | null, refreshKey: number): ConnectionDetailState {
  const [state, setState] = useState<ConnectionDetailState>({data: null, error: null, loading: false});

  useEffect(() => {
    if (!name) {
      setState({data: null, error: null, loading: false});
      return;
    }
    const controller = new AbortController();
    setState((current) => ({...current, error: null, loading: true}));
    loadConnectionDetail(name, controller.signal)
      .then((data) => setState({data, error: null, loading: false}))
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        setState({data: null, error: err instanceof Error ? err.message : String(err), loading: false});
      });
    return () => controller.abort();
  }, [name, refreshKey]);

  return state;
}

export function ConnectionsPage() {
  const [refreshKey, setRefreshKey] = useState(0);
  const [selectedName, setSelectedName] = useState<string | null>(null);
  const [expandedName, setExpandedName] = useState<string | null>(null);
  const [testingName, setTestingName] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<{name: string; status: string; error?: string} | null>(null);
  const connectionPackages = useConnectionPackages();
  const inspectContext = useInspectContext(refreshKey);

  const connections = useMemo(() => {
    const byName = new Map<string, ConnectionRow>();
    for (const file of inspectContext.data?.connectionFiles ?? []) {
      byName.set(file.name, {name: file.name, status: file.hasSpec ? 'not loaded' : 'incomplete', loaded: false, file});
    }
    for (const pkg of connectionPackages.data?.packages ?? []) {
      const current = byName.get(pkg.connectionName) ?? {name: pkg.connectionName, status: 'not loaded', loaded: false};
      byName.set(pkg.connectionName, {...current, pkg});
    }
    for (const runtime of inspectContext.data?.connections ?? []) {
      const current = byName.get(runtime.name) ?? {name: runtime.name, status: runtime.status, loaded: true};
      byName.set(runtime.name, {...current, status: runtime.status, error: runtime.error, loaded: true});
    }
    return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [connectionPackages.data, inspectContext.data]);

  useEffect(() => {
    if (!selectedName && connections.length > 0) {
      const first = connections[0]?.name ?? null;
      setSelectedName(first);
      setExpandedName(first);
    }
  }, [connections, selectedName]);

  const detail = useConnectionDetail(selectedName, refreshKey);

  if (inspectContext.error && connectionPackages.error) {
    return <AgentOffline page="connections" detail={inspectContext.error} />;
  }

  const loadedCount = connections.filter((conn) => conn.loaded).length;
  const missingCredentialCount = connections.filter((conn) => conn.pkg && !conn.pkg.isFulfilled).length;
  const incompleteCount = connections.filter((conn) => !conn.loaded && conn.file && !conn.file.hasSpec).length;
  const unhealthyCount = connections.filter((conn) => conn.loaded && conn.status !== 'connected').length;

  async function refreshAll(): Promise<void> {
    connectionPackages.refetch();
    setRefreshKey((key) => key + 1);
  }

  async function testConnection(name: string): Promise<void> {
    if (testingName) return;
    setTestingName(name);
    setTestResult(null);
    try {
      const data = await loadInspectContext();
      const connection = data.connections?.find((candidate) => candidate.name === name);
      setRefreshKey((key) => key + 1);
      setTestResult({
        name,
        status: connection?.status ?? 'not loaded',
        ...(connection?.error ? {error: connection.error} : {}),
      });
    } catch (err: unknown) {
      setTestResult({name, status: 'error', error: err instanceof Error ? err.message : String(err)});
    } finally {
      setTestingName(null);
    }
  }

  return (
    <div className="space-y-5">
      <header className="flex flex-col gap-3 border-b border-border pb-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 className="text-xl font-semibold text-foreground">Connections</h1>
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
            External systems this agent can use, the credentials they need, and the files that define their surface.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => void refreshAll()}
            className="inline-flex items-center gap-2 rounded-md border border-border px-3 py-2 text-xs text-muted-foreground hover:text-foreground"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            Refresh
          </button>
        </div>
      </header>

      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <SummaryCard icon={Plug} label="Connections" value={String(connections.length)} detail={`${String(loadedCount)} loaded at runtime`} />
        <SummaryCard icon={KeyRound} label="Credentials" value={missingCredentialCount === 0 ? 'OK' : String(missingCredentialCount)} detail={missingCredentialCount === 0 ? 'No missing secrets' : 'connections need secrets'} />
        <SummaryCard icon={Activity} label="Health" value={unhealthyCount === 0 ? 'OK' : String(unhealthyCount)} detail={unhealthyCount === 0 ? 'Loaded connections healthy' : 'runtime issues'} />
        <SummaryCard icon={FileCode} label="Files" value={incompleteCount === 0 ? 'OK' : String(incompleteCount)} detail={incompleteCount === 0 ? 'Specs present' : 'missing spec files'} />
      </section>

      {testResult && (
        <div className={`rounded-md border px-4 py-3 text-sm ${
          testResult.status === 'connected'
            ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400'
            : 'border-amber-500/30 bg-amber-500/10 text-amber-900 dark:text-amber-200'
        }`}>
          Tested <span className="font-mono">{testResult.name}</span>: {testResult.status}
          {testResult.error ? ` - ${testResult.error}` : ''}
        </div>
      )}

      <Panel title="Connection Inventory">
        <ConnectionInventory
          connections={connections}
          loading={inspectContext.loading || connectionPackages.loading}
          expandedName={expandedName}
          selectedName={selectedName}
          detail={detail}
          testingName={testingName}
          onToggle={(name) => {
            setSelectedName(name);
            setExpandedName((current) => current === name ? null : name);
          }}
          onTest={(name) => void testConnection(name)}
        />
      </Panel>
    </div>
  );
}

function ConnectionInventory({
  connections,
  loading,
  expandedName,
  selectedName,
  detail,
  testingName,
  onToggle,
  onTest,
}: {
  connections: ConnectionRow[];
  loading: boolean;
  expandedName: string | null;
  selectedName: string | null;
  detail: ConnectionDetailState;
  testingName: string | null;
  onToggle: (name: string) => void;
  onTest: (name: string) => void;
}) {
  if (loading) return <EmptyPanelText>Loading connections</EmptyPanelText>;
  if (connections.length === 0) return <EmptyPanelText>No connections found in this agent</EmptyPanelText>;

  return (
    <div className="divide-y divide-border">
      {connections.map((connection) => {
        const expanded = expandedName === connection.name;
        const credentialText = credentialSummary(connection.pkg);
        const capabilityText = capabilitySummary(connection, selectedName === connection.name ? detail.data : null);
        return (
          <div key={connection.name} className="py-3 first:pt-0 last:pb-0">
            <div className="grid gap-3 lg:grid-cols-[minmax(0,1.35fr)_0.7fr_0.8fr_0.9fr_auto] lg:items-center">
              <button
                type="button"
                onClick={() => onToggle(connection.name)}
                className="flex min-w-0 items-start gap-2 rounded-md px-2 py-1 text-left hover:bg-muted/60"
              >
                {expanded ? <ChevronDown className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" /> : <ChevronRight className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />}
                <div className="min-w-0">
                  <div className="flex min-w-0 items-center gap-2">
                    <StatusDot tone={connectionTone(connection)} />
                    <p className="truncate font-mono text-sm font-medium text-foreground">{connection.name}</p>
                  </div>
                  <p className="mt-1 truncate text-xs text-muted-foreground">{connection.file?.path ?? 'loaded from package metadata'}</p>
                </div>
              </button>
              <StatusBadge tone={connectionTone(connection)}>{connectionStatusLabel(connection)}</StatusBadge>
              <span className="text-xs text-muted-foreground">{credentialText}</span>
              <span className="text-xs text-muted-foreground">{capabilityText}</span>
              <div className="flex items-center gap-2 lg:justify-end">
                {connection.pkg && (
                  <Link
                    to={`../${connectionConfigPath(connection.pkg.name)}`}
                    className="rounded-md border border-border px-2.5 py-1 text-xs text-muted-foreground hover:text-foreground"
                  >
                    Configure
                  </Link>
                )}
                {connection.loaded && (
                  <button
                    type="button"
                    onClick={() => onTest(connection.name)}
                    disabled={testingName !== null}
                    className="rounded-md border border-border px-2.5 py-1 text-xs text-muted-foreground hover:text-foreground disabled:opacity-50"
                  >
                    {testingName === connection.name ? 'Testing...' : 'Test'}
                  </button>
                )}
              </div>
            </div>

            {expanded && (
              <div className="mt-3 rounded-lg border border-border bg-background p-4">
                <ConnectionExpanded connection={connection} state={selectedName === connection.name ? detail : {data: null, error: null, loading: false}} />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function ConnectionExpanded({connection, state}: {connection: ConnectionRow; state: ConnectionDetailState}) {
  return (
    <div className="space-y-4">
      {connection.error && (
        <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          <AlertCircle className="mt-0.5 h-4 w-4" />
          {connection.error}
        </div>
      )}

      <div className="grid gap-3 md:grid-cols-3">
        <DetailBlock label="Runtime" value={connection.loaded ? connection.status : 'not loaded'} />
        <DetailBlock label="Credentials" value={credentialSummary(connection.pkg)} />
        <DetailBlock label="Files" value={fileSummary(connection.file)} />
      </div>

      {connection.file && !connection.loaded && !connection.file.hasSpec && (
        <div className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-900 dark:text-amber-200">
          This directory has connection documentation but no <span className="font-mono">spec.json</span>, so the runtime cannot load it yet.
        </div>
      )}

      {state.loading && <EmptyPanelText>Loading details</EmptyPanelText>}
      {state.error && (
        <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          <AlertCircle className="mt-0.5 h-4 w-4" />
          {state.error}
        </div>
      )}
      {state.data && <ConnectionDetailView data={state.data} />}

      <div className="flex flex-wrap gap-2">
        {connection.file && (
          <Link
            to={`../files?path=${encodeURIComponent(connection.file.path)}`}
            className="inline-flex items-center gap-1 rounded-md border border-border px-2.5 py-1 text-xs text-muted-foreground hover:text-foreground"
          >
            Files <ExternalLink className="h-3 w-3" />
          </Link>
        )}
        {connection.loaded && (
          <Link
            to={`../${connectionInspectPath(connection.name)}`}
            className="inline-flex items-center gap-1 rounded-md border border-border px-2.5 py-1 text-xs text-muted-foreground hover:text-foreground"
          >
            Inspect <ExternalLink className="h-3 w-3" />
          </Link>
        )}
      </div>
    </div>
  );
}

function ConnectionDetailView({data}: {data: ConnectionDetail}) {
  if (data.kind === 'mcp') return <McpDetail data={data} />;
  if (data.kind === 'files') return <SurfaceList endpoints={data.surface} empty="No endpoints documented in surface.md" />;
  return <RestDetail data={data} />;
}

function RestDetail({data}: {data: RestConnectionDetail}) {
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <StatusBadge tone="neutral">REST</StatusBadge>
        {data.spec?.format && <StatusBadge tone="neutral">{data.spec.format}</StatusBadge>}
        {data.spec?.authType && <StatusBadge tone="neutral">auth: {data.spec.authType}</StatusBadge>}
        {data.spec?.baseUrl && <CodePill>{data.spec.baseUrl}</CodePill>}
      </div>
      <SurfaceList endpoints={data.surface ?? []} empty="No curated endpoints exposed" />
    </div>
  );
}

function McpDetail({data}: {data: McpConnectionDetail}) {
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <StatusBadge tone={data.status === 'connected' ? 'success' : 'warning'}>{data.status}</StatusBadge>
        <StatusBadge tone="neutral">MCP</StatusBadge>
        <StatusBadge tone="neutral">{data.transport}</StatusBadge>
        {data.url && <CodePill>{data.url}</CodePill>}
      </div>
      {data.error && (
        <div className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          {data.error}
        </div>
      )}
      {data.tools.length > 0 ? (
        <div className="grid gap-2 md:grid-cols-2">
          {data.tools.map((tool) => (
            <div key={tool.qualifiedName} className="rounded-lg border border-border bg-card px-3 py-2">
              <p className="font-mono text-sm font-medium text-foreground">{tool.name}</p>
              {tool.description && <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{tool.description}</p>}
            </div>
          ))}
        </div>
      ) : (
        <EmptyPanelText>No MCP tools discovered</EmptyPanelText>
      )}
    </div>
  );
}

function SurfaceList({endpoints, empty}: {endpoints: ConnectionEndpoint[]; empty: string}) {
  if (endpoints.length === 0) return <EmptyPanelText>{empty}</EmptyPanelText>;
  return (
    <div className="overflow-hidden rounded-lg border border-border">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border bg-card">
            <th className="w-20 px-3 py-2 text-left text-xs font-medium text-muted-foreground">Method</th>
            <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground">Path</th>
            <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground">Description</th>
          </tr>
        </thead>
        <tbody>
          {endpoints.map((endpoint) => (
            <tr key={`${endpoint.method}:${endpoint.path}`} className="border-b border-border last:border-0">
              <td className="px-3 py-2"><MethodBadge method={endpoint.method} /></td>
              <td className="px-3 py-2 font-mono text-xs text-foreground">{endpoint.path}</td>
              <td className="px-3 py-2 text-xs text-muted-foreground">{endpoint.description || '-'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function credentialSummary(pkg: ConnectionPackage | undefined): string {
  if (!pkg) return 'No credential metadata';
  if (pkg.envVars.length === 0) return 'No secrets required';
  const setCount = pkg.envVars.filter((envVar) => envVar.set).length;
  return `${String(setCount)}/${String(pkg.envVars.length)} secrets set`;
}

function capabilitySummary(connection: ConnectionRow, detail: ConnectionDetail | null): string {
  if (detail?.kind === 'mcp') return `${String(detail.tools.length)} tools`;
  if (detail?.kind === 'rest') return `${String(detail.surface?.length ?? 0)} endpoints`;
  if (connection.file?.hasSurface) return `${String(connection.file.surfaceCount)} documented endpoints`;
  return 'No surface file';
}

function fileSummary(file: ConnectionFileSummary | undefined): string {
  if (!file) return 'No local files';
  return file.files.join(', ') || 'Empty directory';
}

function connectionStatusLabel(connection: ConnectionRow): string {
  if (connection.loaded) return connection.status;
  if (connection.file && !connection.file.hasSpec) return 'missing spec';
  return 'not loaded';
}

function connectionTone(connection: ConnectionRow): 'success' | 'warning' | 'neutral' {
  if (connection.loaded && connection.status === 'connected' && connection.pkg?.isFulfilled !== false) return 'success';
  if (!connection.loaded || connection.status !== 'connected' || connection.pkg?.isFulfilled === false) return 'warning';
  return 'neutral';
}

function SummaryCard({icon: Icon, label, value, detail}: {icon: LucideIcon; label: string; value: string; detail: string}) {
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
        <Icon className="h-4 w-4 text-muted-foreground" />
      </div>
      <p className="mt-2 text-2xl font-semibold text-foreground">{value}</p>
      <p className="mt-1 truncate text-xs text-muted-foreground">{detail}</p>
    </div>
  );
}

function Panel({title, children}: {title: string; children: ReactNode}) {
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <h2 className="mb-3 text-xs font-medium uppercase tracking-wide text-muted-foreground">{title}</h2>
      {children}
    </div>
  );
}

function DetailBlock({label, value}: {label: string; value: string}) {
  return (
    <div className="rounded-md border border-border bg-card px-3 py-2">
      <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-1 break-words text-sm text-foreground">{value}</p>
    </div>
  );
}

function StatusBadge({tone, children}: {tone: 'success' | 'warning' | 'neutral'; children: ReactNode}) {
  const cls = tone === 'success'
    ? 'bg-emerald-500/10 text-emerald-600'
    : tone === 'warning'
      ? 'bg-amber-500/10 text-amber-700'
      : 'bg-muted text-muted-foreground';
  return <span className={`inline-flex w-fit rounded-full px-2 py-0.5 text-xs font-medium ${cls}`}>{children}</span>;
}

function StatusDot({tone}: {tone: 'success' | 'warning' | 'neutral'}) {
  const cls = tone === 'success' ? 'bg-emerald-500' : tone === 'warning' ? 'bg-amber-500' : 'bg-muted-foreground';
  return <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${cls}`} />;
}

function CodePill({children}: {children: ReactNode}) {
  return <span className="rounded-full bg-muted px-2 py-0.5 font-mono text-[11px] text-muted-foreground">{children}</span>;
}

function MethodBadge({method}: {method: string}) {
  const cls = method === 'GET'
    ? 'text-blue-500'
    : method === 'POST'
      ? 'text-emerald-500'
      : method === 'PUT' || method === 'PATCH'
        ? 'text-amber-500'
        : method === 'DELETE'
          ? 'text-red-500'
          : 'text-muted-foreground';
  return <span className={`font-mono text-xs font-bold uppercase ${cls}`}>{method}</span>;
}

function EmptyPanelText({children}: {children: ReactNode}) {
  return <p className="py-4 text-sm text-muted-foreground">{children}</p>;
}
