/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Plug, Sparkles, BookOpen, Cable } from 'lucide-react';
import Markdown from 'react-markdown';

type InspectKind = 'connections' | 'mcp' | 'skills' | 'knowledge';

interface ConnectionDetail {
  name: string;
  kind: 'rest';
  spec: { baseUrl: string; format: string; authType: string };
  surface: Array<{ method: string; path: string; description: string }>;
  entities: string | null;
  rules: string | null;
  location: string;
}

interface McpToolDetail {
  name: string;
  qualifiedName: string;
  description: string;
  parameters: Record<string, unknown>;
}

interface McpDetail {
  name: string;
  kind: 'mcp';
  status: string;
  error: string | null;
  transport: string;
  command: string | null;
  url: string | null;
  tools: McpToolDetail[];
}

interface SkillDetail {
  name: string;
  description: string;
  trigger: string | null;
  body: string;
  location: string;
}

interface KnowledgeDetail {
  name: string;
  title: string;
  body: string;
  location: string;
}

type DetailData = ConnectionDetail | McpDetail | SkillDetail | KnowledgeDetail;

const kindConfig: Record<InspectKind, { icon: typeof Plug; color: string; label: string }> = {
  connections: { icon: Plug, color: 'emerald', label: 'REST Connection' },
  mcp: { icon: Cable, color: 'violet', label: 'MCP Server' },
  skills: { icon: Sparkles, color: 'amber', label: 'Skill' },
  knowledge: { icon: BookOpen, color: 'blue', label: 'Knowledge' },
};

function ConnectionView({ data }: { data: ConnectionDetail }) {
  return (
    <div className="space-y-6">
      {/* Metadata badges */}
      <div className="flex flex-wrap gap-2">
        <span className="text-[11px] px-2 py-0.5 rounded-full bg-emerald-100 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 font-medium">
          {data.spec.format}
        </span>
        <span className="text-[11px] px-2 py-0.5 rounded-full bg-gray-100 dark:bg-white/[0.06] text-gray-600 dark:text-zinc-400 font-medium">
          auth: {data.spec.authType}
        </span>
        {data.spec.baseUrl && (
          <span className="text-[11px] px-2 py-0.5 rounded-full bg-gray-100 dark:bg-white/[0.06] text-gray-500 dark:text-zinc-500 font-mono">
            {data.spec.baseUrl}
          </span>
        )}
      </div>

      {/* API Surface */}
      {data.surface.length > 0 && (
        <section>
          <h2 className="text-sm font-semibold text-gray-800 dark:text-zinc-200 mb-3">
            API Surface ({String(data.surface.length)} endpoints)
          </h2>
          <div className="border border-gray-200 dark:border-zinc-800 rounded-lg overflow-hidden">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="bg-gray-50 dark:bg-zinc-900/50">
                  <th className="text-left px-3 py-2 text-gray-500 dark:text-zinc-500 font-medium w-20">Method</th>
                  <th className="text-left px-3 py-2 text-gray-500 dark:text-zinc-500 font-medium">Path</th>
                  <th className="text-left px-3 py-2 text-gray-500 dark:text-zinc-500 font-medium">Description</th>
                </tr>
              </thead>
              <tbody>
                {data.surface.map((endpoint, i) => (
                  <tr key={`endpoint-${String(i)}`} className="border-t border-gray-100 dark:border-zinc-800/50">
                    <td className="px-3 py-2">
                      <span className={`text-[10px] font-mono font-bold uppercase ${
                        endpoint.method === 'GET' ? 'text-blue-500' :
                        endpoint.method === 'POST' ? 'text-emerald-500' :
                        endpoint.method === 'PUT' ? 'text-amber-500' :
                        endpoint.method === 'DELETE' ? 'text-red-500' :
                        'text-gray-500'
                      }`}>
                        {endpoint.method}
                      </span>
                    </td>
                    <td className="px-3 py-2 font-mono text-gray-700 dark:text-zinc-300">{endpoint.path}</td>
                    <td className="px-3 py-2 text-gray-500 dark:text-zinc-500">{endpoint.description}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* Entities */}
      {data.entities && (
        <section>
          <h2 className="text-sm font-semibold text-gray-800 dark:text-zinc-200 mb-3">Entities</h2>
          <div className="bg-gray-50 dark:bg-zinc-900/30 border border-gray-200 dark:border-zinc-800 rounded-lg p-4">
            <div className="text-[13px] text-gray-700 dark:text-zinc-300 prose dark:prose-invert prose-sm max-w-none">
              <Markdown>{data.entities}</Markdown>
            </div>
          </div>
        </section>
      )}

      {/* Rules */}
      {data.rules && (
        <section>
          <h2 className="text-sm font-semibold text-gray-800 dark:text-zinc-200 mb-3">Rules</h2>
          <div className="bg-gray-50 dark:bg-zinc-900/30 border border-gray-200 dark:border-zinc-800 rounded-lg p-4">
            <div className="text-[13px] text-gray-700 dark:text-zinc-300 prose dark:prose-invert prose-sm max-w-none">
              <Markdown>{data.rules}</Markdown>
            </div>
          </div>
        </section>
      )}
    </div>
  );
}

function McpView({ data }: { data: McpDetail }) {
  return (
    <div className="space-y-6">
      {/* Metadata badges */}
      <div className="flex flex-wrap gap-2">
        <span className="text-[11px] px-2 py-0.5 rounded-full bg-violet-100 dark:bg-violet-500/10 text-violet-700 dark:text-violet-400 font-medium">
          {data.transport}
        </span>
        <span className={`text-[11px] px-2 py-0.5 rounded-full font-medium ${
          data.status === 'connected'
            ? 'bg-emerald-100 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-400'
            : 'bg-red-100 dark:bg-red-500/10 text-red-700 dark:text-red-400'
        }`}>
          {data.status}
        </span>
        {data.command && (
          <span className="text-[11px] px-2 py-0.5 rounded-full bg-gray-100 dark:bg-white/[0.06] text-gray-500 dark:text-zinc-500 font-mono">
            {data.command}
          </span>
        )}
        {data.url && (
          <span className="text-[11px] px-2 py-0.5 rounded-full bg-gray-100 dark:bg-white/[0.06] text-gray-500 dark:text-zinc-500 font-mono">
            {data.url}
          </span>
        )}
      </div>

      {/* Error */}
      {data.error && (
        <div className="bg-red-50 dark:bg-red-500/5 border border-red-200 dark:border-red-500/20 rounded-lg px-4 py-3">
          <p className="text-sm text-red-700 dark:text-red-400 font-mono">{data.error}</p>
        </div>
      )}

      {/* Tools */}
      {data.tools.length > 0 && (
        <section>
          <h2 className="text-sm font-semibold text-gray-800 dark:text-zinc-200 mb-3">
            Tools ({String(data.tools.length)})
          </h2>
          <div className="space-y-3">
            {data.tools.map((tool) => (
              <div key={tool.name} className="border border-gray-200 dark:border-zinc-800 rounded-lg overflow-hidden">
                <div className="px-4 py-3 bg-gray-50 dark:bg-zinc-900/50">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-mono font-semibold text-gray-800 dark:text-zinc-200">{tool.name}</span>
                  </div>
                  {tool.description && (
                    <p className="text-xs text-gray-500 dark:text-zinc-500 mt-1">{tool.description}</p>
                  )}
                </div>
                {tool.parameters && Object.keys(tool.parameters).length > 0 && (
                  <div className="px-4 py-3 border-t border-gray-100 dark:border-zinc-800/50">
                    <pre className="text-[12px] text-gray-600 dark:text-zinc-400 font-mono whitespace-pre-wrap overflow-auto leading-relaxed">
                      {JSON.stringify(tool.parameters, null, 2)}
                    </pre>
                  </div>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      {data.tools.length === 0 && data.status === 'connected' && (
        <div className="text-center py-8 text-gray-400 dark:text-zinc-600 text-sm">
          Connected but no tools discovered.
        </div>
      )}
    </div>
  );
}

function SkillView({ data }: { data: SkillDetail }) {
  return (
    <div className="space-y-6">
      {/* Metadata */}
      <div className="space-y-2">
        {data.description && (
          <p className="text-sm text-gray-600 dark:text-zinc-400">{data.description}</p>
        )}
        {data.trigger && (
          <div className="flex items-center gap-2">
            <span className="text-[11px] px-2 py-0.5 rounded-full bg-amber-100 dark:bg-amber-500/10 text-amber-700 dark:text-amber-400 font-medium">
              trigger
            </span>
            <span className="text-xs text-gray-500 dark:text-zinc-500 font-mono">{data.trigger}</span>
          </div>
        )}
      </div>

      {/* Skill body */}
      <section>
        <h2 className="text-sm font-semibold text-gray-800 dark:text-zinc-200 mb-3">Skill Definition</h2>
        <div className="bg-gray-50 dark:bg-zinc-900/30 border border-gray-200 dark:border-zinc-800 rounded-lg p-4 overflow-auto prose dark:prose-invert prose-sm max-w-none prose-headings:text-gray-900 dark:prose-headings:text-zinc-200 prose-p:text-gray-900 dark:prose-p:text-zinc-300 prose-strong:text-gray-900 dark:prose-strong:text-zinc-200 prose-code:text-indigo-700 dark:prose-code:text-indigo-300 prose-code:bg-gray-100 dark:prose-code:bg-zinc-800 prose-code:px-1 prose-code:py-0.5 prose-code:rounded prose-li:text-gray-900 dark:prose-li:text-zinc-300">
          <Markdown>{data.body}</Markdown>
        </div>
      </section>
    </div>
  );
}

function KnowledgeView({ data }: { data: KnowledgeDetail }) {
  return (
    <div className="space-y-6">
      {data.title && data.title !== data.name && (
        <p className="text-sm text-gray-600 dark:text-zinc-400">{data.title}</p>
      )}

      <section>
        <div className="bg-gray-50 dark:bg-zinc-900/30 border border-gray-200 dark:border-zinc-800 rounded-lg p-4 overflow-auto">
          <div className="text-[13px] text-gray-700 dark:text-zinc-300 prose dark:prose-invert prose-sm max-w-none">
            <Markdown>{data.body}</Markdown>
          </div>
        </div>
      </section>
    </div>
  );
}

export function InspectDetailPage() {
  const { kind, name } = useParams<{ kind: string; name: string }>();
  const [data, setData] = useState<DetailData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const validKinds = new Set<string>(['connections', 'mcp', 'skills', 'knowledge']);
  const inspectKind = kind && validKinds.has(kind) ? kind as InspectKind : undefined; // eslint-disable-line @typescript-eslint/no-unsafe-type-assertion -- validated above
  const config = inspectKind ? kindConfig[inspectKind] : undefined;

  useEffect(() => {
    if (!inspectKind || !name) return;
    setLoading(true);
    setError(null);

    fetch(`/inspect/${inspectKind}/${encodeURIComponent(name)}`)
      .then((res) => {
        if (!res.ok) throw new Error(`${String(res.status)} ${res.statusText}`);
        return res.json();
      })
      .then((body: unknown) => {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- Server response
        setData(body as DetailData);
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : 'Failed to load');
      })
      .finally(() => { setLoading(false); });
  }, [inspectKind, name]);

  if (!config) {
    return <div className="p-6 text-gray-500 dark:text-zinc-500">Unknown inspect type</div>;
  }

  if (loading) {
    return <div className="p-6 text-gray-500 dark:text-zinc-500 text-sm">Loading...</div>;
  }

  if (error || !data) {
    return <div className="p-6 text-red-500 text-sm">{error ?? 'Not found'}</div>;
  }

  const Icon = config.icon;
  const displayName = name?.replace(/[-_]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()) ?? '';

  return (
    <div className="h-full flex flex-col bg-white dark:bg-[#0a0a0f]">
      {/* Header */}
      <div className="border-b border-gray-200 dark:border-zinc-800/50 px-6 py-4">
        <div className="flex items-center gap-2">
          <Icon className={`h-4 w-4 text-${config.color}-500`} />
          <h1 className="text-lg font-semibold text-gray-900 dark:text-zinc-200">{displayName}</h1>
        </div>
        <div className="flex items-center gap-3 mt-1">
          <span className={`text-[11px] px-2 py-0.5 rounded-full bg-${config.color}-100 dark:bg-${config.color}-500/10 text-${config.color}-700 dark:text-${config.color}-400 font-medium`}>
            {config.label}
          </span>
          {'location' in data && data.location && (
            <span className="text-[11px] text-gray-400 dark:text-zinc-600 font-mono">
              {data.location}
            </span>
          )}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto scrollbar-thin">
        <div className="max-w-3xl mx-auto px-6 py-6">
          {/* eslint-disable @typescript-eslint/no-unsafe-type-assertion -- data shape validated by kind field */}
          {'kind' in data && data.kind === 'mcp' ? (
            <McpView data={data as unknown as McpDetail} />
          ) : inspectKind === 'connections' ? (
            <ConnectionView data={data as unknown as ConnectionDetail} />
          ) : inspectKind === 'mcp' ? (
            <McpView data={data as unknown as McpDetail} />
          ) : inspectKind === 'skills' ? (
            <SkillView data={data as unknown as SkillDetail} />
          ) : inspectKind === 'knowledge' ? (
            <KnowledgeView data={data as unknown as KnowledgeDetail} />
          ) : null}
          {/* eslint-enable @typescript-eslint/no-unsafe-type-assertion */}
        </div>
      </div>
    </div>
  );
}
