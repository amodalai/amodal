/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { AgentOffline } from '@/components/AgentOffline';
import { runtimeApiUrl } from '@/lib/api';
import { PROVIDER_COLORS, modelToProvider, estimateCost } from '@/lib/model-pricing';
import { ArrowLeft, Wrench } from 'lucide-react';

interface ToolCall {
  toolId: string;
  toolName: string;
  parameters: Record<string, unknown>;
}

interface HistoryMessage {
  type: 'user' | 'assistant_text';
  id: string;
  text: string;
  timestamp: string;
  toolCalls?: ToolCall[];
}

interface SessionDetail {
  id: string;
  title: string;
  message_count: number;
  token_usage: { input_tokens: number; output_tokens: number; total_tokens: number };
  model: string | null;
  provider: string | null;
  created_at: string;
  updated_at: string;
  messages: HistoryMessage[];
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

function MessageBubble({ msg }: { msg: HistoryMessage }) {
  if (msg.type === 'user') {
    return (
      <div className="flex justify-end">
        <div className="bg-primary-solid text-white rounded-2xl rounded-tr-md px-4 py-2.5 max-w-[70%]">
          <p className="text-sm whitespace-pre-wrap">{msg.text}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {msg.toolCalls && msg.toolCalls.length > 0 && (
        <div className="space-y-1">
          {msg.toolCalls.map((tc) => (
            <ToolCallCard key={tc.toolId} toolCall={tc} />
          ))}
        </div>
      )}
      {msg.text && (
        <div className="bg-muted rounded-2xl rounded-tl-md px-4 py-2.5 max-w-[85%]">
          <p className="text-sm text-foreground whitespace-pre-wrap">{msg.text}</p>
        </div>
      )}
    </div>
  );
}

function ToolCallCard({ toolCall }: { toolCall: ToolCall }) {
  const [expanded, setExpanded] = useState(false);
  const hasParams = Object.keys(toolCall.parameters).length > 0;

  return (
    <button
      onClick={() => hasParams && setExpanded(!expanded)}
      className={`flex items-start gap-2 text-left w-full px-3 py-1.5 rounded-lg border border-border bg-card text-xs ${hasParams ? 'cursor-pointer hover:bg-muted/50' : 'cursor-default'}`}
    >
      <Wrench className="w-3.5 h-3.5 text-muted-foreground mt-0.5 shrink-0" />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="font-mono font-medium text-foreground">{toolCall.toolName}</span>
          {hasParams && (
            <span className="text-muted-foreground">{expanded ? '▾' : '▸'}</span>
          )}
        </div>
        {expanded && (
          <pre className="mt-1.5 text-[11px] text-muted-foreground overflow-x-auto whitespace-pre-wrap break-all">
            {JSON.stringify(toolCall.parameters, null, 2)}
          </pre>
        )}
      </div>
    </button>
  );
}

export function SessionDetailPage() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const [session, setSession] = useState<SessionDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!sessionId) return;
    fetch(runtimeApiUrl(`/sessions/history/${sessionId}`), { signal: AbortSignal.timeout(5_000) })
      .then((r) => {
        if (!r.ok) throw new Error(`Runtime returned ${String(r.status)}`);
        // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- system boundary
        return r.json() as Promise<SessionDetail>;
      })
      .then(setSession)
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : String(err));
      });
  }, [sessionId]);

  if (error) return <AgentOffline page="session detail" detail={error} />;
  if (!session) return null;

  const cost = session.model
    ? estimateCost(session.model, session.token_usage.input_tokens, session.token_usage.output_tokens)
    : null;
  const colors = session.model ? PROVIDER_COLORS[modelToProvider(session.model)] : null;

  return (
    <div className="space-y-0 h-full flex flex-col">
      {/* Header */}
      <div className="border-b border-border px-6 py-4 shrink-0">
        <Link to="../sessions" className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground mb-2">
          <ArrowLeft className="w-3.5 h-3.5" />
          Sessions
        </Link>
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-lg font-semibold text-foreground">{session.title}</h1>
            <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
              <span>{formatDate(session.created_at)}</span>
              <span>·</span>
              <span>{session.message_count} messages</span>
              <span>·</span>
              <span className="font-mono">{formatTokens(session.token_usage.total_tokens)} tokens</span>
              {cost != null && (
                <>
                  <span>·</span>
                  <span className="font-mono">${cost.toFixed(3)}</span>
                </>
              )}
              {session.model && (
                <>
                  <span>·</span>
                  <div className="flex items-center gap-1">
                    {colors && <span className={`w-1.5 h-1.5 rounded-full ${colors.dot}`} />}
                    <span className="font-mono">{session.model}</span>
                  </div>
                </>
              )}
            </div>
          </div>
          <span className="text-[10px] font-mono text-muted-foreground bg-muted px-2 py-1 rounded">
            {session.id.slice(0, 8)}
          </span>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-6 py-5">
        <div className="max-w-2xl mx-auto space-y-4">
          {session.messages.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">No messages in this session.</p>
          ) : (
            session.messages.map((msg) => (
              <MessageBubble key={msg.id} msg={msg} />
            ))
          )}
        </div>
      </div>
    </div>
  );
}
