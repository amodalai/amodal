/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

/**
 * Shared tool-call card used by both the main ChatPage and the admin
 * ConfigChatPage. Renders an inline badge for each tool invocation
 * with a contextual summary of the key parameters so the user can
 * tell at a glance *what* the tool did, not just *which* tool ran.
 *
 * Known tools get specific formatting:
 *   read_repo_file   → path + line range
 *   grep_repo_files  → pattern
 *   list_repo_files  → directory
 *   glob_repo_files  → pattern
 *   edit_repo_file   → path
 *   web_search       → query excerpt
 *   fetch_url        → hostname
 *   request          → connection + METHOD + endpoint
 *
 * Everything else gets a generic first-2-params summary.
 */

import { Loader2, CheckCircle2, XCircle } from 'lucide-react';
import type { ToolCallInfo } from '@amodalai/react';
import { extractImageUrls } from '../utils/extractImageUrls';
import { ImagePreview } from './ImagePreview';
import type { ImageSource } from './ImagePreview';

// ---------------------------------------------------------------------------
// Method color map for the request tool
// ---------------------------------------------------------------------------

const METHOD_COLORS: Record<string, string> = {
  GET: 'text-blue-500',
  POST: 'text-emerald-500',
  PUT: 'text-amber-500',
  PATCH: 'text-amber-500',
  DELETE: 'text-red-500',
};

// ---------------------------------------------------------------------------
// Parameter summary
// ---------------------------------------------------------------------------

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max - 1) + '…' : s;
}

function summarizeParams(toolName: string, params: Record<string, unknown>): string | null {
  switch (toolName) {
    case 'read_repo_file': {
      const path = typeof params['path'] === 'string' ? params['path'] : null;
      if (!path) return null;
      const offset = typeof params['offset'] === 'number' ? params['offset'] : undefined;
      const limit = typeof params['limit'] === 'number' ? params['limit'] : undefined;
      if (offset !== undefined && limit !== undefined) {
        return `${path}:${String(offset)}-${String(offset + limit)}`;
      }
      if (offset !== undefined) return `${path}:${String(offset)}+`;
      return path;
    }
    case 'read_many_repo_files': {
      const paths = Array.isArray(params['paths']) ? params['paths'] : null;
      if (!paths) return null;
      const shown = paths.slice(0, 3).map((p) => typeof p === 'string' ? p : '?');
      return shown.join(', ') + (paths.length > 3 ? ` +${String(paths.length - 3)} more` : '');
    }
    case 'grep_repo_files': {
      const pattern = typeof params['pattern'] === 'string' ? params['pattern'] : null;
      const dir = typeof params['directory'] === 'string' ? params['directory'] : null;
      if (!pattern) return null;
      return dir ? `"${truncate(pattern, 30)}" in ${dir}` : `"${truncate(pattern, 40)}"`;
    }
    case 'glob_repo_files': {
      const pattern = typeof params['pattern'] === 'string' ? params['pattern'] : null;
      return pattern ? truncate(pattern, 40) : null;
    }
    case 'list_repo_files': {
      const dir = typeof params['directory'] === 'string' ? params['directory'] : null;
      return dir ?? null;
    }
    case 'edit_repo_file':
    case 'write_repo_file':
    case 'delete_repo_file': {
      const path = typeof params['path'] === 'string' ? params['path'] : null;
      return path ?? null;
    }
    case 'web_search': {
      const query = typeof params['query'] === 'string' ? params['query'] : null;
      return query ? truncate(query, 50) : null;
    }
    case 'fetch_url': {
      const url = typeof params['url'] === 'string' ? params['url'] : null;
      if (!url) return null;
      try { return new URL(url).hostname; } catch { return truncate(url, 40); }
    }
    case 'request': {
      // The main ChatPage has its own rich card for this — return null
      // so the caller can render the connection-specific layout instead.
      return null;
    }
    case 'query_store':
    case 'upsert_store':
    case 'delete_store': {
      const store = typeof params['store'] === 'string' ? params['store'] : null;
      return store ?? null;
    }
    default:
      return genericSummary(params);
  }
}

function genericSummary(params: Record<string, unknown>): string | null {
  const entries = Object.entries(params).slice(0, 2);
  if (entries.length === 0) return null;
  return entries
    .map(([k, v]) => {
      const val = typeof v === 'string' ? v : JSON.stringify(v);
      return `${k}: ${truncate(val, 25)}`;
    })
    .join('  ');
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Extract renderable images from a tool call result.
 * Handles both structured content blocks (Phase 2) and URL detection in strings (Phase 1).
 */
function getResultImages(result: ToolCallInfo['result']): ImageSource[] {
  if (!result) return [];
  if (typeof result === 'string') return extractImageUrls(result);
  if (Array.isArray(result)) {
    return result
      .filter((b): b is {type: 'image'; mimeType: string; data: string} =>
        typeof b === 'object' && b !== null && 'type' in b && b.type === 'image')
      .map((b) => ({mimeType: b.mimeType, data: b.data}));
  }
  return [];
}

interface ToolCallCardProps {
  call: ToolCallInfo;
}

export function ToolCallCard({ call }: ToolCallCardProps) {
  const isRunning = call.status === 'running';
  const isError = call.status === 'error';
  const params = call.parameters ?? {};

  // Request tool — rich layout with connection + method + path
  const isRequest = call.toolName === 'request' && typeof params['connection'] === 'string';
  if (isRequest) {
    const connection = String(params['connection']);
    const method = String(params['method'] ?? 'GET').toUpperCase();
    const endpoint = typeof params['endpoint'] === 'string' ? params['endpoint'] : '';
    const requestImages = !isRunning ? getResultImages(call.result) : [];
    return (
      <div className="my-1.5 rounded-lg bg-muted border border-border overflow-hidden">
        <div className="flex items-center gap-2 px-3 py-2">
          <StatusIcon isRunning={isRunning} isError={isError} />
          <span className="text-[13px] font-semibold text-foreground">{connection}</span>
          <span className={`text-[10px] font-mono font-bold ${METHOD_COLORS[method] ?? 'text-gray-500'}`}>
            {method}
          </span>
          <span className="text-[12px] font-mono text-muted-foreground truncate">{endpoint}</span>
          <Duration ms={call.duration_ms} />
        </div>
        {requestImages.length > 0 && <ImagePreview images={requestImages} />}
      </div>
    );
  }

  // All other tools — compact badge with parameter summary
  const summary = summarizeParams(call.toolName, params);
  const images = !isRunning ? getResultImages(call.result) : [];
  return (
    <div className="my-1.5 rounded-lg bg-muted border border-border overflow-hidden">
      <div className="flex items-center gap-2 px-3.5 py-2 text-xs font-mono">
        <StatusIcon isRunning={isRunning} isError={isError} />
        <span className="text-primary font-semibold shrink-0">{call.toolName}</span>
        {summary && (
          <span className="text-muted-foreground truncate">{summary}</span>
        )}
        <Duration ms={call.duration_ms} />
      </div>
      {/* Ephemeral tool log — progress from ctx.log() during execution */}
      {isRunning && call.logMessage && (
        <div className="px-3.5 pb-1.5 text-[11px] text-muted-foreground italic truncate">
          {call.logMessage}
        </div>
      )}
      {/* Error detail on failed calls */}
      {isError && call.error && (
        <div className="px-3.5 pb-2 text-[11px] text-red-400 truncate">
          {call.error}
        </div>
      )}
      {/* Images from tool results */}
      {images.length > 0 && <ImagePreview images={images} />}
    </div>
  );
}

function StatusIcon({ isRunning, isError }: { isRunning: boolean; isError: boolean }) {
  if (isRunning) return <Loader2 className="h-3.5 w-3.5 text-primary animate-spin shrink-0" />;
  if (isError) return <XCircle className="h-3.5 w-3.5 text-red-400 shrink-0" />;
  return <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400 shrink-0" />;
}

function Duration({ ms }: { ms?: number }) {
  if (ms == null) return null;
  return <span className="text-muted-foreground ml-auto tabular-nums shrink-0">{String(ms)}ms</span>;
}
