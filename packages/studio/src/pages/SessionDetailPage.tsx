/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import {useState, useEffect} from 'react';
import {useParams, Link} from 'react-router-dom';
import {AgentOffline} from '@/components/AgentOffline';
import {runtimeApiUrl} from '@/lib/api';
import {
  PROVIDER_COLORS,
  modelToProvider,
  estimateCost,
  formatPrice,
} from '@/lib/model-pricing';
import {formatShortDateTime, formatTokens} from '@/lib/format';
import {MessageList} from '@amodalai/react/widget';
import type {ChatMessage, ToolCallInfo} from '@amodalai/react/widget';
import {ArrowLeft, Clock, Hash, MessageSquare} from 'lucide-react';

const SESSIONS_ROUTE = '../sessions';

interface ToolCall {
  toolId: string;
  toolName: string;
  parameters: Record<string, unknown>;
  result?: unknown;
}

interface HistoryMessage {
  role?: 'user' | 'assistant';
  type: 'user' | 'assistant_text';
  id: string;
  text: string;
  timestamp: string;
  toolCalls?: ToolCall[];
}

interface SessionDetail {
  id: string;
  app_id: string;
  scope_id: string;
  title: string;
  tags: string[];
  message_count: number;
  token_usage: {
    input_tokens: number;
    output_tokens: number;
    total_tokens: number;
  };
  model: string | null;
  provider: string | null;
  metadata?: Record<string, unknown>;
  created_at: string;
  updated_at: string;
  messages: HistoryMessage[];
}

function getMessageKind(msg: HistoryMessage): 'user' | 'assistant' {
  return msg.type === 'user' || msg.role === 'user' ? 'user' : 'assistant';
}

function resultError(result: unknown): string | undefined {
  if (
    typeof result === 'object' &&
    result !== null &&
    'type' in result &&
    result.type === 'error-text' &&
    'value' in result
  ) {
    return typeof result.value === 'string'
      ? result.value
      : JSON.stringify(result.value);
  }
  return undefined;
}

function toWidgetToolCall(toolCall: ToolCall): ToolCallInfo {
  const error = resultError(toolCall.result);
  return {
    toolId: toolCall.toolId,
    toolName: toolCall.toolName,
    parameters: toolCall.parameters,
    status: error ? 'error' : 'success',
    result: toolCall.result,
    error,
  };
}

function toWidgetMessages(messages: HistoryMessage[]): ChatMessage[] {
  return messages.map((msg) => {
    if (getMessageKind(msg) === 'user') {
      return {
        type: 'user',
        id: msg.id,
        text: msg.text,
        timestamp: msg.timestamp,
      };
    }
    const toolCalls = (msg.toolCalls ?? []).map(toWidgetToolCall);
    return {
      type: 'assistant_text',
      id: msg.id,
      text: msg.text,
      toolCalls,
      confirmations: [],
      skillActivations: [],
      kbProposals: [],
      widgets: [],
      contentBlocks: [
        ...(toolCalls.length > 0
          ? [{type: 'tool_calls' as const, calls: toolCalls}]
          : []),
        ...(msg.text
          ? [{type: 'text' as const, text: msg.text}]
          : []),
      ],
      timestamp: msg.timestamp,
    };
  });
}

function Stat({label, value}: {label: string; value: string}) {
  return (
    <div className="rounded-lg border border-border bg-card px-3 py-2">
      <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div className="mt-1 text-sm font-medium text-foreground">{value}</div>
    </div>
  );
}

function MetadataRow({label, value}: {label: string; value: string}) {
  return (
    <div className="space-y-1">
      <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div className="break-all font-mono text-xs text-foreground">{value}</div>
    </div>
  );
}

export function SessionDetailPage() {
  const {sessionId} = useParams<{sessionId: string}>();
  const [session, setSession] = useState<SessionDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    if (!sessionId) return;
    setError(null);
    setNotFound(false);
    setSession(null);

    fetch(runtimeApiUrl(`/sessions/history/${sessionId}`), {
      signal: AbortSignal.timeout(5_000),
    })
      .then((r) => {
        if (r.status === 404) {
          setNotFound(true);
          return null;
        }
        if (!r.ok) throw new Error(`Runtime returned ${String(r.status)}`);
        // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- system boundary
        return r.json() as Promise<SessionDetail>;
      })
      .then((data) => {
        if (data) setSession(data);
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : String(err));
      });
  }, [sessionId]);

  if (error) return <AgentOffline page="session detail" detail={error} />;
  if (notFound) {
    return (
      <div className="space-y-4">
        <Link
          to={SESSIONS_ROUTE}
          className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Sessions
        </Link>
        <div className="rounded-lg border border-border bg-card px-5 py-8 text-center">
          <h1 className="text-base font-semibold text-foreground">
            Session not found
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            This session may have been deleted or belongs to another agent.
          </p>
        </div>
      </div>
    );
  }
  if (!session) {
    return (
      <div className="flex h-48 items-center justify-center text-sm text-muted-foreground">
        Loading session...
      </div>
    );
  }

  const cost = session.model
    ? estimateCost(
        session.model,
        session.token_usage.input_tokens,
        session.token_usage.output_tokens,
      )
    : null;
  const colors = session.model
    ? PROVIDER_COLORS[modelToProvider(session.model)]
    : null;
  const userMessages = session.messages.filter(
    (m) => getMessageKind(m) === 'user',
  ).length;
  const assistantMessages = session.messages.length - userMessages;
  const widgetMessages = toWidgetMessages(session.messages);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="shrink-0 border-b border-border px-6 py-4">
          <Link
          to={SESSIONS_ROUTE}
          className="mb-2 inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Sessions
        </Link>
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h1 className="truncate text-lg font-semibold text-foreground">
              {session.title}
            </h1>
            <div className="mt-1 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
              <span className="inline-flex items-center gap-1">
                <Clock className="h-3.5 w-3.5" />
                {formatShortDateTime(session.created_at)}
              </span>
              <span className="inline-flex items-center gap-1">
                <MessageSquare className="h-3.5 w-3.5" />
                {session.message_count} messages
              </span>
              {session.model && (
                <span className="inline-flex items-center gap-1 font-mono">
                  {colors && (
                    <span
                      className={`h-1.5 w-1.5 rounded-full ${colors.dot}`}
                    />
                  )}
                  {session.model}
                </span>
              )}
            </div>
          </div>
          <span className="inline-flex items-center gap-1 rounded bg-muted px-2 py-1 font-mono text-[10px] text-muted-foreground">
            <Hash className="h-3 w-3" />
            {session.id.slice(0, 8)}
          </span>
        </div>
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[minmax(0,1fr)_280px]">
        <main className="min-h-0 overflow-y-auto px-6 py-5">
          <div className="pcw-widget mx-auto h-full max-w-3xl rounded-none bg-transparent">
            {session.messages.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">
                No messages in this session.
              </p>
            ) : (
              <MessageList
                messages={widgetMessages}
                isStreaming={false}
                verboseTools
                emptyStateText="No messages in this session."
              />
            )}
          </div>
        </main>

        <aside className="min-h-0 overflow-y-auto border-t border-border bg-card/50 px-4 py-5 lg:border-l lg:border-t-0">
          <div className="space-y-5">
            <div className="grid grid-cols-2 gap-2">
              <Stat label="Users" value={String(userMessages)} />
              <Stat label="Replies" value={String(assistantMessages)} />
              <Stat
                label="Tokens"
                value={formatTokens(session.token_usage.total_tokens)}
              />
              <Stat
                label="Cost"
                value={cost != null ? formatPrice(cost) : '—'}
              />
            </div>

            <div className="space-y-3 rounded-lg border border-border bg-card p-3">
              <MetadataRow label="Session ID" value={session.id} />
              <MetadataRow label="App ID" value={session.app_id} />
              {session.scope_id && (
                <MetadataRow label="Scope" value={session.scope_id} />
              )}
              {session.provider && (
                <MetadataRow label="Provider" value={session.provider} />
              )}
              {session.model && (
                <MetadataRow label="Model" value={session.model} />
              )}
              <MetadataRow
                label="Created"
                value={formatShortDateTime(session.created_at)}
              />
              <MetadataRow
                label="Updated"
                value={formatShortDateTime(session.updated_at)}
              />
            </div>

            {session.tags.length > 0 && (
              <div className="space-y-2">
                <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                  Tags
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {session.tags.map((tag) => (
                    <span
                      key={tag}
                      className="rounded bg-muted px-2 py-1 text-xs text-muted-foreground"
                    >
                      {tag}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}
