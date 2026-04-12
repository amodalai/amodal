/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import { fetchFromRuntime } from '@/lib/runtime-client';
import { AgentOffline } from '@/components/AgentOffline';
import { notFound } from 'next/navigation';
export const dynamic = 'force-dynamic';

type InspectKind = 'connections' | 'mcp' | 'skills' | 'knowledge';

const VALID_KINDS = new Set<string>(['connections', 'mcp', 'skills', 'knowledge']);

interface ConnectionDetail {
  kind: 'connections';
  name: string;
  type?: string;
  baseUrl?: string;
  authStatus?: string;
  endpoints?: Array<{ method: string; path: string; description?: string }>;
}

interface McpDetail {
  kind: 'mcp';
  name: string;
  toolCount?: number;
  tools?: Array<{ name: string; description?: string }>;
}

interface SkillDetail {
  kind: 'skills';
  name: string;
  content?: string;
}

interface KnowledgeDetail {
  kind: 'knowledge';
  name: string;
  content?: string;
}

type InspectDetail = ConnectionDetail | McpDetail | SkillDetail | KnowledgeDetail;

function ConnectionView({ data }: { data: ConnectionDetail }) {
  return (
    <div className="space-y-4">
      <div className="bg-card border border-border rounded-lg p-4">
        <dl className="space-y-3 text-sm">
          {data.type && (
            <div>
              <dt className="text-muted-foreground">Type</dt>
              <dd className="text-foreground mt-0.5">{data.type}</dd>
            </div>
          )}
          {data.baseUrl && (
            <div>
              <dt className="text-muted-foreground">Base URL</dt>
              <dd className="text-foreground font-mono mt-0.5">{data.baseUrl}</dd>
            </div>
          )}
          {data.authStatus && (
            <div>
              <dt className="text-muted-foreground">Auth Status</dt>
              <dd className="mt-0.5">
                <span
                  className={`inline-flex items-center gap-1 text-sm ${
                    data.authStatus === 'configured' ? 'text-emerald-600' : 'text-amber-600'
                  }`}
                >
                  <span
                    className={`w-1.5 h-1.5 rounded-full ${
                      data.authStatus === 'configured' ? 'bg-emerald-500' : 'bg-amber-500'
                    }`}
                  />
                  {data.authStatus}
                </span>
              </dd>
            </div>
          )}
        </dl>
      </div>

      {data.endpoints && data.endpoints.length > 0 && (
        <div className="bg-card border border-border rounded-lg overflow-hidden">
          <div className="px-4 py-3 border-b border-border">
            <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wide">
              Endpoints
            </h2>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border">
                <th className="text-left px-4 py-2 text-muted-foreground font-medium">Method</th>
                <th className="text-left px-4 py-2 text-muted-foreground font-medium">Path</th>
                <th className="text-left px-4 py-2 text-muted-foreground font-medium">Description</th>
              </tr>
            </thead>
            <tbody>
              {data.endpoints.map((ep, i) => (
                <tr key={i} className="border-b border-border last:border-0">
                  <td className="px-4 py-2">
                    <span className="font-mono text-blue-500">{ep.method}</span>
                  </td>
                  <td className="px-4 py-2 font-mono text-foreground">{ep.path}</td>
                  <td className="px-4 py-2 text-muted-foreground">{ep.description ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function McpView({ data }: { data: McpDetail }) {
  return (
    <div className="space-y-4">
      {data.toolCount != null && (
        <div className="bg-card border border-border rounded-lg p-4">
          <p className="text-sm text-muted-foreground">
            <span className="text-foreground font-medium">{data.toolCount}</span> tools available
          </p>
        </div>
      )}

      {data.tools && data.tools.length > 0 && (
        <div className="bg-card border border-border rounded-lg overflow-hidden">
          <div className="px-4 py-3 border-b border-border">
            <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wide">
              Tools
            </h2>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border">
                <th className="text-left px-4 py-2 text-muted-foreground font-medium">Name</th>
                <th className="text-left px-4 py-2 text-muted-foreground font-medium">Description</th>
              </tr>
            </thead>
            <tbody>
              {data.tools.map((tool) => (
                <tr key={tool.name} className="border-b border-border last:border-0">
                  <td className="px-4 py-2 font-mono text-foreground">{tool.name}</td>
                  <td className="px-4 py-2 text-muted-foreground">{tool.description ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function ContentView({ content }: { content?: string }) {
  if (!content) {
    return <p className="text-sm text-muted-foreground">No content available.</p>;
  }

  return (
    <div className="bg-card border border-border rounded-lg p-4">
      <pre className="text-sm text-foreground whitespace-pre-wrap break-words font-mono bg-muted rounded p-4 max-h-[600px] overflow-y-auto scrollbar-thin">
        {content}
      </pre>
    </div>
  );
}

function DetailContent({ data }: { data: InspectDetail }) {
  switch (data.kind) {
    case 'connections':
      return <ConnectionView data={data} />;
    case 'mcp':
      return <McpView data={data} />;
    case 'skills':
      return <ContentView content={data.content} />;
    case 'knowledge':
      return <ContentView content={data.content} />;
    default: {
      const _exhaustive: never = data;
      return _exhaustive;
    }
  }
}

interface PageProps {
  params: Promise<{ kind: string; name: string }>;
}

export default async function InspectDetailPage({ params }: PageProps) {
  const { kind, name } = await params;

  if (!VALID_KINDS.has(kind)) {
    notFound();
  }

  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- validated by VALID_KINDS.has() above
  const validKind = kind as InspectKind;

  let detail: Omit<InspectDetail, 'kind'>;
  try {
    detail = await fetchFromRuntime<Omit<InspectDetail, 'kind'>>(
      `/inspect/${encodeURIComponent(kind)}/${encodeURIComponent(name)}`,
    );
  } catch {
    return <AgentOffline page={`inspect/${kind}/${name}`} />;
  }

  const data = { ...detail, kind: validKind } as InspectDetail;

  return (
    <div className="space-y-6">
      <div>
        <p className="text-sm text-muted-foreground capitalize">{kind}</p>
        <h1 className="text-xl font-semibold text-foreground">{name}</h1>
      </div>

      <DetailContent data={data} />
    </div>
  );
}
