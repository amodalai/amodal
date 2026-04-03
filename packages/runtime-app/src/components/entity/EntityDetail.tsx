/**
 * @license
 * Copyright 2025 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import type { StoreFieldDefinitionInfo, StoreDocument, StoreDocumentMeta } from '@amodalai/react';
import { FieldRenderer } from './FieldRenderer';
import { VersionHistory } from './VersionHistory';
import { Clock, Cpu, Zap, DollarSign, Activity } from 'lucide-react';

export interface EntityDetailProps {
  schema: Record<string, StoreFieldDefinitionInfo>;
  document: StoreDocument;
  meta: StoreDocumentMeta;
  history: StoreDocument[];
  hasTrace?: boolean;
}

export function EntityDetail({
  schema,
  document: doc,
  meta,
  history,
  hasTrace,
}: EntityDetailProps) {
  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">{doc.key}</h1>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded font-mono">v{String(doc.version)}</span>
          {meta.stale && (
            <span className="px-2 py-0.5 rounded bg-amber-50 dark:bg-amber-500/10 text-amber-700 dark:text-amber-400 border border-amber-200 dark:border-amber-500/20 text-xs font-medium">
              Stale
            </span>
          )}
        </div>
      </div>

      {/* Fields */}
      <div className="bg-white dark:bg-zinc-900/50 border border-border rounded-xl divide-y divide-gray-100 dark:divide-zinc-800/50">
        {Object.entries(schema).map(([fieldName, fieldDef]) => (
          <div key={fieldName} className="px-5 py-3.5 flex">
            <div className="w-44 text-sm font-medium text-muted-foreground shrink-0 pt-0.5">
              {fieldName}
              {fieldDef.nullable && (
                <span className="text-[10px] ml-1 text-gray-300 dark:text-zinc-600">?</span>
              )}
            </div>
            <div className="text-sm flex-1 min-w-0 text-foreground">
              <FieldRenderer field={fieldDef} value={doc.payload[fieldName]} mode="detail" />
            </div>
          </div>
        ))}
      </div>

      {/* Metadata */}
      <div className="bg-white dark:bg-zinc-900/50 border border-border rounded-xl p-5">
        <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-widest mb-3">
          Metadata
        </h2>
        <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
          <MetaItem icon={<Clock className="h-3.5 w-3.5" />} label="Computed" value={formatTime(meta.computedAt)} />
          {meta.ttl !== undefined && <MetaItem icon={<Activity className="h-3.5 w-3.5" />} label="TTL" value={`${String(meta.ttl)}s`} />}
          {meta.modelUsed && <MetaItem icon={<Cpu className="h-3.5 w-3.5" />} label="Model" value={meta.modelUsed} />}
          {meta.durationMs !== undefined && <MetaItem icon={<Zap className="h-3.5 w-3.5" />} label="Duration" value={`${String(meta.durationMs)}ms`} />}
          {meta.tokenCost !== undefined && <MetaItem icon={<Activity className="h-3.5 w-3.5" />} label="Tokens" value={meta.tokenCost.toLocaleString()} />}
          {meta.estimatedCostUsd !== undefined && <MetaItem icon={<DollarSign className="h-3.5 w-3.5" />} label="Cost" value={`$${meta.estimatedCostUsd.toFixed(4)}`} />}
          {meta.automationId && <MetaItem icon={<Zap className="h-3.5 w-3.5" />} label="Automation" value={meta.automationId} />}
          {meta.skillId && <MetaItem icon={<Activity className="h-3.5 w-3.5" />} label="Skill" value={meta.skillId} />}
        </div>
      </div>

      {/* Trace */}
      {hasTrace && meta.trace && (
        <details className="bg-white dark:bg-zinc-900/50 border border-border rounded-xl group">
          <summary className="px-5 py-3.5 cursor-pointer text-sm font-medium text-muted-foreground hover:text-foreground transition-colors">
            Reasoning Trace
          </summary>
          <pre className="px-5 py-4 border-t border-gray-100 dark:border-zinc-800 text-xs whitespace-pre-wrap text-gray-600 dark:text-zinc-400 bg-muted overflow-auto max-h-96 scrollbar-thin font-mono">
            {meta.trace}
          </pre>
        </details>
      )}

      {/* Version history */}
      <VersionHistory history={history} />
    </div>
  );
}

function MetaItem({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="flex items-center gap-2 text-sm">
      <span className="text-muted-foreground">{icon}</span>
      <span className="text-muted-foreground">{label}:</span>
      <span className="text-foreground font-mono text-xs truncate">{value}</span>
    </div>
  );
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  const now = Date.now();
  const diff = now - d.getTime();

  if (diff < 60000) return 'just now';
  if (diff < 3600000) return `${String(Math.floor(diff / 60000))} min ago`;
  if (diff < 86400000) return `${String(Math.floor(diff / 3600000))}h ago`;
  return d.toLocaleString();
}
