/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Plug, Sparkles, BookOpen } from 'lucide-react';
import Markdown from 'react-markdown';

type InspectKind = 'connections' | 'skills' | 'knowledge';

interface ConnectionDetail {
  name: string;
  spec: { baseUrl: string; format: string; authType: string };
  surface: Array<{ method: string; path: string; description: string }>;
  entities: string | null;
  rules: string | null;
  location: string;
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

const kindConfig: Record<InspectKind, { icon: typeof Plug; color: string; label: string }> = {
  connections: { icon: Plug, color: 'emerald', label: 'Connection' },
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
        <div className="bg-gray-50 dark:bg-zinc-900/30 border border-gray-200 dark:border-zinc-800 rounded-lg p-4 overflow-auto">
          <pre className="text-[13px] text-gray-700 dark:text-zinc-300 font-mono whitespace-pre-wrap leading-relaxed">{data.body}</pre>
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
  const [data, setData] = useState<ConnectionDetail | SkillDetail | KnowledgeDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const validKinds = new Set<string>(['connections', 'skills', 'knowledge']);
  const inspectKind = kind && validKinds.has(kind) ? kind as 'connections' | 'skills' | 'knowledge' : undefined; // eslint-disable-line @typescript-eslint/no-unsafe-type-assertion -- validated above
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
        setData(body as ConnectionDetail | SkillDetail | KnowledgeDetail);
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
          {/* eslint-disable @typescript-eslint/no-unsafe-type-assertion -- data shape matches inspectKind */}
          {inspectKind === 'connections' && <ConnectionView data={data as unknown as ConnectionDetail} />}
          {inspectKind === 'skills' && <SkillView data={data as unknown as SkillDetail} />}
          {inspectKind === 'knowledge' && <KnowledgeView data={data as unknown as KnowledgeDetail} />}
          {/* eslint-enable @typescript-eslint/no-unsafe-type-assertion */}
        </div>
      </div>
    </div>
  );
}
