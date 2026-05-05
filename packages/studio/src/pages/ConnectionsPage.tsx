/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import {useEffect, useMemo, useState} from 'react';
import type {ReactNode} from 'react';
import {Link} from 'react-router-dom';
import {Activity, AlertCircle, CheckCircle2, ExternalLink, KeyRound, Plug, RefreshCw} from 'lucide-react';
import type {LucideIcon} from 'lucide-react';
import {AgentOffline} from '@/components/AgentOffline';
import {runtimeApiUrl} from '@/lib/api';
import {useGettingStarted} from '../hooks/useGettingStarted';
import type {GettingStartedPackage} from '../hooks/useGettingStarted';
import {
  connectionConfigPath,
  connectionInspectPath,
  GETTING_STARTED_PATH,
} from '../lib/routes';
import {useDraftWorkspace} from '../hooks/useDraftWorkspace';

interface InspectConnectionStatus {
  name: string;
  status: 'connected' | 'error' | string;
  error?: string;
}

interface InspectContextResponse {
  connections?: InspectConnectionStatus[];
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

type ConnectionDetail = RestConnectionDetail | McpConnectionDetail;

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
  const [state, setState] = useState<InspectContextState>({
    data: null,
    error: null,
    loading: true,
  });

  useEffect(() => {
    const controller = new AbortController();
    setState((current) => ({...current, error: null, loading: true}));
    loadInspectContext(controller.signal)
      .then((data) => setState({data, error: null, loading: false}))
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        setState({
          data: null,
          error: err instanceof Error ? err.message : String(err),
          loading: false,
        });
      });
    return () => controller.abort();
  }, [refreshKey]);

  return state;
}

function useConnectionDetail(name: string | null, refreshKey: number): ConnectionDetailState {
  const [state, setState] = useState<ConnectionDetailState>({
    data: null,
    error: null,
    loading: false,
  });

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
        setState({
          data: null,
          error: err instanceof Error ? err.message : String(err),
          loading: false,
        });
      });
    return () => controller.abort();
  }, [name, refreshKey]);

  return state;
}

export function ConnectionsPage() {
  const [refreshKey, setRefreshKey] = useState(0);
  const [selectedName, setSelectedName] = useState<string | null>(null);
  const [testingName, setTestingName] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<{name: string; status: string; error?: string} | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [createResult, setCreateResult] = useState<{name: string; paths: string[]} | null>(null);
  const [createError, setCreateError] = useState<string | null>(null);
  const gettingStarted = useGettingStarted();
  const workspace = useDraftWorkspace();
  const inspectContext = useInspectContext(refreshKey);

  const loadedConnections = useMemo(
    () => [...(inspectContext.data?.connections ?? [])].sort((a, b) => a.name.localeCompare(b.name)),
    [inspectContext.data],
  );
  const packages = useMemo(
    () => [...(gettingStarted.data?.packages ?? [])].sort((a, b) => a.displayName.localeCompare(b.displayName)),
    [gettingStarted.data],
  );

  useEffect(() => {
    if (!selectedName && loadedConnections.length > 0) {
      setSelectedName(loadedConnections[0]?.name ?? null);
    }
  }, [loadedConnections, selectedName]);

  const detail = useConnectionDetail(selectedName, refreshKey);

  if (inspectContext.error && gettingStarted.error) {
    return <AgentOffline page="connections" detail={inspectContext.error} />;
  }

  const missingCredentialPackages = packages.filter((pkg) => !pkg.isFulfilled);
  const unhealthyConnections = loadedConnections.filter((conn) => conn.status !== 'connected');
  const configuredPackages = packages.length - missingCredentialPackages.length;

  async function refreshAll(): Promise<void> {
    gettingStarted.refetch();
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
        status: connection?.status ?? 'unknown',
        ...(connection?.error ? {error: connection.error} : {}),
      });
    } catch (err: unknown) {
      setTestResult({
        name,
        status: 'error',
        error: err instanceof Error ? err.message : String(err),
      });
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
            Credential readiness, runtime health, and exposed API surface for this agent.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            to={`../${GETTING_STARTED_PATH}`}
            className="rounded-md border border-border px-3 py-2 text-xs text-muted-foreground hover:text-foreground"
          >
            Setup
          </Link>
          <button
            type="button"
            onClick={() => {
              setCreateOpen((open) => !open);
              setCreateError(null);
              setCreateResult(null);
            }}
            className="rounded-md bg-primary-solid px-3 py-2 text-xs font-medium text-white hover:opacity-90"
          >
            New connection
          </button>
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

      {createOpen && (
        <NewConnectionPanel
          saving={workspace.isLoading}
          error={createError}
          result={createResult}
          onCancel={() => setCreateOpen(false)}
          onCreate={async (input) => {
            setCreateError(null);
            setCreateResult(null);
            const files = buildConnectionDrafts(input);
            for (const file of files) {
              await workspace.saveDraft(file.path, file.content);
              const latestError = workspace.getLatestError();
              if (latestError) {
                setCreateError(latestError.message);
                return;
              }
            }
            setCreateResult({name: input.name, paths: files.map((file) => file.path)});
          }}
        />
      )}

      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <SummaryCard
          icon={Plug}
          label="Loaded"
          value={String(loadedConnections.length)}
          detail={loadedConnections.length === 1 ? 'runtime connection' : 'runtime connections'}
        />
        <SummaryCard
          icon={KeyRound}
          label="Credentials"
          value={packages.length > 0 ? `${String(configuredPackages)}/${String(packages.length)}` : '0'}
          detail={missingCredentialPackages.length === 0 ? 'All configured' : `${String(missingCredentialPackages.length)} need setup`}
        />
        <SummaryCard
          icon={Activity}
          label="Health"
          value={unhealthyConnections.length === 0 ? 'OK' : String(unhealthyConnections.length)}
          detail={unhealthyConnections.length === 0 ? 'No runtime errors' : 'connections failing health check'}
        />
        <SummaryCard
          icon={CheckCircle2}
          label="Surface"
          value={detail.data ? surfaceCount(detail.data) : '-'}
          detail={selectedName ? `selected: ${selectedName}` : 'No connection selected'}
        />
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

      <section className="grid gap-4 xl:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)]">
        <Panel title="Installed Packages">
          <PackageList packages={packages} loading={gettingStarted.loading} />
        </Panel>

        <Panel title="Runtime Connections">
          <RuntimeConnectionList
            connections={loadedConnections}
            loading={inspectContext.loading}
            selectedName={selectedName}
            testingName={testingName}
            onSelect={setSelectedName}
            onTest={(name) => void testConnection(name)}
          />
        </Panel>
      </section>

      <Panel
        title="Connection Detail"
        action={
          selectedName ? (
            <Link
              to={`../${connectionInspectPath(selectedName)}`}
              className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
            >
              Inspect <ExternalLink className="h-3 w-3" />
            </Link>
          ) : null
        }
      >
        <ConnectionDetailView selectedName={selectedName} state={detail} />
      </Panel>
    </div>
  );
}

function PackageList({packages, loading}: {packages: GettingStartedPackage[]; loading: boolean}) {
  if (loading) return <EmptyPanelText>Loading packages</EmptyPanelText>;
  if (packages.length === 0) return <EmptyPanelText>No connection packages installed</EmptyPanelText>;
  return (
    <div className="divide-y divide-border">
      {packages.map((pkg) => {
        const envTotal = pkg.envVars.length;
        const envSet = pkg.envVars.filter((envVar) => envVar.set).length;
        return (
          <div key={pkg.name} className="grid gap-3 py-3 first:pt-0 last:pb-0 md:grid-cols-[minmax(0,1fr)_auto]">
            <div className="min-w-0">
              <div className="flex min-w-0 items-center gap-2">
                {pkg.icon ? (
                  <img src={pkg.icon} alt="" className="h-5 w-5 shrink-0 rounded" />
                ) : (
                  <Plug className="h-4 w-4 shrink-0 text-muted-foreground" />
                )}
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-foreground">{pkg.displayName}</p>
                  <p className="truncate font-mono text-xs text-muted-foreground">{pkg.name}</p>
                </div>
              </div>
              {pkg.description && (
                <p className="mt-2 line-clamp-2 text-xs text-muted-foreground">{pkg.description}</p>
              )}
              {envTotal > 0 && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {pkg.envVars.map((envVar) => (
                    <span
                      key={envVar.name}
                      className={`rounded-full px-2 py-0.5 font-mono text-[11px] ${
                        envVar.set
                          ? 'bg-emerald-500/10 text-emerald-600'
                          : 'bg-amber-500/10 text-amber-700'
                      }`}
                      title={envVar.description}
                    >
                      {envVar.set ? 'set ' : 'missing '}
                      {envVar.name}
                    </span>
                  ))}
                </div>
              )}
            </div>
            <div className="flex items-start gap-2 md:justify-end">
              <StatusBadge tone={pkg.isFulfilled ? 'success' : 'warning'}>
                {envTotal === 0 ? 'No secrets' : `${String(envSet)}/${String(envTotal)} set`}
              </StatusBadge>
              <Link
                to={`../${connectionConfigPath(pkg.name)}`}
                className="rounded-md border border-border px-2.5 py-1 text-xs text-muted-foreground hover:text-foreground"
              >
                Configure
              </Link>
            </div>
          </div>
        );
      })}
    </div>
  );
}

interface NewConnectionInput {
  name: string;
  baseUrl: string;
  testPath: string;
  authEnvVar: string;
}

function normalizeConnectionName(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function normalizeEnvName(value: string): string {
  return value.trim().toUpperCase().replace(/[^A-Z0-9_]+/g, '_').replace(/^_+|_+$/g, '');
}

function buildConnectionDrafts(input: NewConnectionInput): Array<{path: string; content: string}> {
  const envVar = normalizeEnvName(input.authEnvVar);
  const spec = {
    protocol: 'rest',
    baseUrl: input.baseUrl.trim(),
    format: 'rest',
    ...(input.testPath.trim() ? {testPath: input.testPath.trim()} : {}),
    ...(envVar
      ? {
          auth: {
            type: 'bearer',
            token: `env:${envVar}`,
            header: 'Authorization',
            prefix: 'Bearer',
          },
        }
      : {}),
  };
  const root = `connections/${input.name}`;
  return [
    {path: `${root}/spec.json`, content: `${JSON.stringify(spec, null, 2)}\n`},
    {path: `${root}/access.json`, content: `${JSON.stringify({endpoints: {}}, null, 2)}\n`},
    {
      path: `${root}/surface.md`,
      content: [
        `# ${input.name}`,
        '',
        'Add curated endpoints here after confirming the API surface.',
        '',
        '## Example',
        '',
        '### GET /health',
        '',
        'Checks whether the upstream API is reachable.',
        '',
      ].join('\n'),
    },
    {
      path: `${root}/rules.md`,
      content: [
        `# ${input.name} rules`,
        '',
        '- Keep destructive operations behind confirmation.',
        '- Do not request fields the agent does not need.',
        '',
      ].join('\n'),
    },
  ];
}

function NewConnectionPanel({
  saving,
  error,
  result,
  onCancel,
  onCreate,
}: {
  saving: boolean;
  error: string | null;
  result: {name: string; paths: string[]} | null;
  onCancel: () => void;
  onCreate: (input: NewConnectionInput) => Promise<void>;
}) {
  const [nameDraft, setNameDraft] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [testPath, setTestPath] = useState('/health');
  const [authEnvVar, setAuthEnvVar] = useState('');
  const name = normalizeConnectionName(nameDraft);
  const canCreate = name.length > 0 && baseUrl.trim().length > 0 && !saving;

  return (
    <section className="rounded-lg border border-border bg-card p-4">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-foreground">New REST connection</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Creates connection files as drafts. Publish the draft when the spec is ready.
          </p>
        </div>
        <button
          type="button"
          onClick={onCancel}
          className="text-xs text-muted-foreground hover:text-foreground"
        >
          Close
        </button>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <label className="space-y-1">
          <span className="text-xs font-medium text-muted-foreground">Name</span>
          <input
            type="text"
            value={nameDraft}
            onChange={(event) => setNameDraft(event.target.value)}
            placeholder="booking-api"
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
          />
          {name && <span className="font-mono text-[11px] text-muted-foreground">connections/{name}</span>}
        </label>
        <label className="space-y-1">
          <span className="text-xs font-medium text-muted-foreground">Base URL</span>
          <input
            type="url"
            value={baseUrl}
            onChange={(event) => setBaseUrl(event.target.value)}
            placeholder="https://api.example.com"
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
          />
        </label>
        <label className="space-y-1">
          <span className="text-xs font-medium text-muted-foreground">Health path</span>
          <input
            type="text"
            value={testPath}
            onChange={(event) => setTestPath(event.target.value)}
            placeholder="/health"
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
          />
        </label>
        <label className="space-y-1">
          <span className="text-xs font-medium text-muted-foreground">Bearer token env var</span>
          <input
            type="text"
            value={authEnvVar}
            onChange={(event) => setAuthEnvVar(event.target.value)}
            placeholder="BOOKING_API_TOKEN"
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
          />
        </label>
      </div>

      {error && (
        <div className="mt-3 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          {error}
        </div>
      )}
      {result && (
        <div className="mt-3 rounded-md border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-700 dark:text-emerald-400">
          Created {result.paths.length} draft files for <span className="font-mono">{result.name}</span>.
        </div>
      )}

      <div className="mt-4 flex justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="rounded-md border border-border px-3 py-2 text-xs text-muted-foreground hover:text-foreground"
        >
          Cancel
        </button>
        <button
          type="button"
          disabled={!canCreate}
          onClick={() => void onCreate({name, baseUrl, testPath, authEnvVar})}
          className="rounded-md bg-primary-solid px-3 py-2 text-xs font-medium text-white hover:opacity-90 disabled:opacity-50"
        >
          {saving ? 'Creating...' : 'Create drafts'}
        </button>
      </div>
    </section>
  );
}

function RuntimeConnectionList({
  connections,
  loading,
  selectedName,
  testingName,
  onSelect,
  onTest,
}: {
  connections: InspectConnectionStatus[];
  loading: boolean;
  selectedName: string | null;
  testingName: string | null;
  onSelect: (name: string) => void;
  onTest: (name: string) => void;
}) {
  if (loading) return <EmptyPanelText>Checking runtime connections</EmptyPanelText>;
  if (connections.length === 0) return <EmptyPanelText>No runtime connections loaded</EmptyPanelText>;
  return (
    <div className="divide-y divide-border">
      {connections.map((connection) => {
        const active = selectedName === connection.name;
        return (
          <div key={connection.name} className="grid gap-3 py-3 first:pt-0 last:pb-0 md:grid-cols-[minmax(0,1fr)_auto]">
            <button
              type="button"
              onClick={() => onSelect(connection.name)}
              className={`min-w-0 rounded-md px-2 py-1 text-left ${
                active ? 'bg-sidebar-active ring-1 ring-border/70' : 'hover:bg-muted/60'
              }`}
            >
              <div className="flex items-center gap-2">
                <StatusDot ok={connection.status === 'connected'} />
                <p className="truncate font-mono text-sm font-medium text-foreground">{connection.name}</p>
              </div>
              <p className="mt-1 truncate text-xs text-muted-foreground">
                {connection.status}
                {connection.error ? ` - ${connection.error}` : ''}
              </p>
            </button>
            <div className="flex items-start gap-2 md:justify-end">
              <button
                type="button"
                onClick={() => onTest(connection.name)}
                disabled={testingName !== null}
                className="rounded-md border border-border px-2.5 py-1 text-xs text-muted-foreground hover:text-foreground disabled:opacity-50"
              >
                {testingName === connection.name ? 'Testing...' : 'Test'}
              </button>
              <Link
                to={`../${connectionInspectPath(connection.name)}`}
                className="rounded-md border border-border px-2.5 py-1 text-xs text-muted-foreground hover:text-foreground"
              >
                Inspect
              </Link>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function ConnectionDetailView({selectedName, state}: {selectedName: string | null; state: ConnectionDetailState}) {
  if (!selectedName) return <EmptyPanelText>Select a runtime connection to inspect its surface</EmptyPanelText>;
  if (state.loading) return <EmptyPanelText>Loading {selectedName}</EmptyPanelText>;
  if (state.error) {
    return (
      <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
        <AlertCircle className="mt-0.5 h-4 w-4" />
        {state.error}
      </div>
    );
  }
  if (!state.data) return <EmptyPanelText>No detail loaded</EmptyPanelText>;

  if (state.data.kind === 'mcp') {
    return <McpDetail data={state.data} />;
  }
  return <RestDetail data={state.data} />;
}

function RestDetail({data}: {data: RestConnectionDetail}) {
  const endpoints = data.surface ?? [];
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        <StatusBadge tone="neutral">REST</StatusBadge>
        {data.spec?.format && <StatusBadge tone="neutral">{data.spec.format}</StatusBadge>}
        {data.spec?.authType && <StatusBadge tone="neutral">auth: {data.spec.authType}</StatusBadge>}
        {data.spec?.baseUrl && (
          <span className="rounded-full bg-muted px-2 py-0.5 font-mono text-[11px] text-muted-foreground">
            {data.spec.baseUrl}
          </span>
        )}
      </div>

      {endpoints.length > 0 ? (
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
                  <td className="px-3 py-2">
                    <MethodBadge method={endpoint.method} />
                  </td>
                  <td className="px-3 py-2 font-mono text-xs text-foreground">{endpoint.path}</td>
                  <td className="px-3 py-2 text-xs text-muted-foreground">{endpoint.description ?? '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <EmptyPanelText>No curated endpoints exposed</EmptyPanelText>
      )}

      {data.location && (
        <p className="font-mono text-xs text-muted-foreground">{data.location}</p>
      )}
    </div>
  );
}

function McpDetail({data}: {data: McpConnectionDetail}) {
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        <StatusBadge tone={data.status === 'connected' ? 'success' : 'warning'}>
          {data.status}
        </StatusBadge>
        <StatusBadge tone="neutral">{data.transport}</StatusBadge>
        {data.command && (
          <span className="rounded-full bg-muted px-2 py-0.5 font-mono text-[11px] text-muted-foreground">
            {data.command}
          </span>
        )}
        {data.url && (
          <span className="rounded-full bg-muted px-2 py-0.5 font-mono text-[11px] text-muted-foreground">
            {data.url}
          </span>
        )}
      </div>
      {data.error && (
        <div className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          {data.error}
        </div>
      )}
      {data.tools.length > 0 ? (
        <div className="grid gap-2 md:grid-cols-2">
          {data.tools.map((tool) => (
            <div key={tool.qualifiedName} className="rounded-lg border border-border bg-background px-3 py-2">
              <p className="font-mono text-sm font-medium text-foreground">{tool.name}</p>
              {tool.description && (
                <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{tool.description}</p>
              )}
            </div>
          ))}
        </div>
      ) : (
        <EmptyPanelText>No MCP tools discovered</EmptyPanelText>
      )}
    </div>
  );
}

function surfaceCount(detail: ConnectionDetail): string {
  if (detail.kind === 'mcp') return String(detail.tools.length);
  return String(detail.surface?.length ?? 0);
}

function SummaryCard({
  icon: Icon,
  label,
  value,
  detail,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  detail: string;
}) {
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

function Panel({title, action, children}: {title: string; action?: ReactNode; children: ReactNode}) {
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{title}</h2>
        {action}
      </div>
      {children}
    </div>
  );
}

function StatusBadge({tone, children}: {tone: 'success' | 'warning' | 'neutral'; children: ReactNode}) {
  const cls = tone === 'success'
    ? 'bg-emerald-500/10 text-emerald-600'
    : tone === 'warning'
      ? 'bg-amber-500/10 text-amber-700'
      : 'bg-muted text-muted-foreground';
  return <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${cls}`}>{children}</span>;
}

function StatusDot({ok}: {ok: boolean}) {
  return <span className={`h-2 w-2 rounded-full ${ok ? 'bg-emerald-500' : 'bg-amber-500'}`} />;
}

function MethodBadge({method}: {method: string}) {
  const cls = method === 'GET'
    ? 'text-blue-500'
    : method === 'POST'
      ? 'text-emerald-500'
      : method === 'PUT'
        ? 'text-amber-500'
        : method === 'DELETE'
          ? 'text-red-500'
          : 'text-muted-foreground';
  return <span className={`font-mono text-xs font-bold uppercase ${cls}`}>{method}</span>;
}

function EmptyPanelText({children}: {children: ReactNode}) {
  return <p className="py-4 text-sm text-muted-foreground">{children}</p>;
}
