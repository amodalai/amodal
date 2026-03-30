/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Play, Clock, CheckCircle2, Loader2, Zap } from 'lucide-react';
import { CronExpressionParser } from 'cron-parser';
import cronstrue from 'cronstrue';
import Markdown from 'react-markdown';

interface AutomationInfo {
  name: string;
  title: string;
  prompt: string;
  schedule?: string;
  trigger: string;
}

interface SessionSummary {
  id: string;
  createdAt: number;
  summary: string;
  automationName?: string;
}

interface HistoryMessage {
  role: string;
  text: string;
}

function formatRelative(ts: number): string {
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${String(mins)}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${String(hours)}h ago`;
  const days = Math.floor(hours / 24);
  return `${String(days)}d ago`;
}

function getNextRun(schedule: string): string | null {
  const interval = CronExpressionParser.parse(schedule);
  const next = interval.next().toDate();
  const diffMs = next.getTime() - Date.now();
  const mins = Math.floor(diffMs / 60_000);
  if (mins < 1) return 'less than 1m';
  if (mins < 60) return `${String(mins)}m`;
  const hours = Math.floor(mins / 60);
  const remainMins = mins % 60;
  if (hours < 24) return remainMins > 0 ? `${String(hours)}h ${String(remainMins)}m` : `${String(hours)}h`;
  return `${String(Math.floor(hours / 24))}d`;
}

export function AutomationDetailPage() {
  const { automationName } = useParams<{ automationName: string }>();
  const [automation, setAutomation] = useState<AutomationInfo | null>(null);
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [expandedSession, setExpandedSession] = useState<string | null>(null);
  const [sessionMessages, setSessionMessages] = useState<Record<string, HistoryMessage[]>>({});
  const [isRunning, setIsRunning] = useState(false);
  const [liveText, setLiveText] = useState('');
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    if (!automationName) return;
    try {
      // Fetch automation info
      const autoRes = await fetch('/automations');
      if (autoRes.ok) {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- Server response
        const body = await autoRes.json() as { automations: AutomationInfo[] };
        const found = body.automations.find((a) => a.name === automationName);
        if (found) setAutomation(found);
      }

      // Fetch sessions for this automation
      const sessRes = await fetch(`/sessions?automation=${encodeURIComponent(automationName)}`);
      if (sessRes.ok) {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- Server response
        const body = await sessRes.json() as { sessions: SessionSummary[] };
        setSessions(body.sessions);
      }
    } catch { /* */ }
    setLoading(false);
  }, [automationName]);

  useEffect(() => { void fetchData(); }, [fetchData]);

  const handleRunNow = useCallback(async () => {
    if (!automationName) return;
    setIsRunning(true);
    setLiveText('');

    try {
      const res = await fetch(`/automations/${encodeURIComponent(automationName)}/stream`, { method: 'POST' });
      const reader = res.body?.getReader();
      const decoder = new TextDecoder();

      if (reader) {
        let buffer = '';
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() ?? '';
          for (const line of lines) {
            if (!line.startsWith('data: ')) continue;
            try {
              // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- SSE event parsing
              const event = JSON.parse(line.substring(6)) as Record<string, unknown>;
              if (event['type'] === 'text_delta' && typeof event['content'] === 'string') {
                setLiveText((prev) => prev + String(event['content']));
              }
            } catch { /* skip */ }
          }
        }
      }
    } catch { /* */ }

    setIsRunning(false);
    // Keep liveText visible so user can read the result
    void fetchData();
  }, [automationName, fetchData]);

  const loadSessionMessages = useCallback(async (sessionId: string) => {
    if (sessionMessages[sessionId]) {
      setExpandedSession(expandedSession === sessionId ? null : sessionId);
      return;
    }
    try {
      const res = await fetch(`/session/${encodeURIComponent(sessionId)}`);
      if (res.ok) {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- Server response
        const body = await res.json() as { messages: HistoryMessage[] };
        setSessionMessages((prev) => ({ ...prev, [sessionId]: body.messages }));
        setExpandedSession(sessionId);
      }
    } catch { /* */ }
  }, [sessionMessages, expandedSession]);

  if (loading) {
    return <div className="p-6 text-gray-500 dark:text-zinc-500 text-sm">Loading...</div>;
  }

  if (!automation) {
    return <div className="p-6 text-gray-500 dark:text-zinc-500">Automation not found</div>;
  }

  const nextRun = automation.schedule ? getNextRun(automation.schedule) : null;

  return (
    <div className="h-full flex flex-col bg-white dark:bg-[#0a0a0f]">
      {/* Header */}
      <div className="border-b border-gray-200 dark:border-zinc-800/50 px-6 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div>
              <div className="flex items-center gap-2">
                <Zap className="h-4 w-4 text-purple-500" />
                <h1 className="text-lg font-semibold text-gray-900 dark:text-zinc-200">{automation.title}</h1>
              </div>
              <div className="flex items-center gap-3 mt-1">
                <span className="text-[11px] px-2 py-0.5 rounded-full bg-purple-100 dark:bg-purple-500/10 text-purple-700 dark:text-purple-400 font-medium">
                  {automation.trigger}
                </span>
                {automation.schedule && (
                  <span className="flex items-center gap-1 text-xs text-gray-500 dark:text-zinc-500">
                    <Clock className="h-3 w-3" />
                    {cronstrue.toString(automation.schedule, { use24HourTimeFormat: true })}
                  </span>
                )}
                {nextRun && (
                  <span className="text-xs text-gray-400 dark:text-zinc-600">
                    Next in {nextRun}
                  </span>
                )}
              </div>
              <p className="text-xs text-gray-500 dark:text-zinc-500 leading-relaxed mt-2 max-w-2xl line-clamp-3">
                {automation.prompt}
              </p>
            </div>
          </div>
          <button
            onClick={() => { void handleRunNow(); }}
            disabled={isRunning}
            className="flex items-center gap-1.5 px-4 py-2 text-sm font-medium rounded-lg bg-purple-600 text-white hover:bg-purple-500 transition-colors disabled:opacity-50"
          >
            {isRunning ? (
              <><Loader2 className="h-4 w-4 animate-spin" /> Running...</>
            ) : (
              <><Play className="h-4 w-4" /> Run Now</>
            )}
          </button>
        </div>
      </div>

      {/* Run history */}
      <div className="flex-1 overflow-y-auto scrollbar-thin">
        <div className="max-w-3xl mx-auto px-4 py-6">
          {/* Live/latest run output */}
          {(isRunning || liveText) && (
            <div className="mb-6 border border-purple-500/20 rounded-xl p-4 bg-purple-500/5">
              <div className="flex items-center gap-2 mb-3 text-xs text-purple-400 font-medium">
                {isRunning ? (
                  <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Running now...</>
                ) : (
                  <><CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" /> Latest run</>
                )}
              </div>
              {liveText ? (
                <div className="text-[13px] text-gray-700 dark:text-zinc-300 prose dark:prose-invert prose-sm max-w-none">
                  <Markdown>{liveText}</Markdown>
                </div>
              ) : (
                <div className="text-xs text-gray-400 dark:text-zinc-600">Waiting for agent response...</div>
              )}
            </div>
          )}

          {sessions.length === 0 && !isRunning ? (
            <div className="text-center py-12 text-gray-400 dark:text-zinc-600 text-sm">
              No runs yet. Click Run Now to trigger this automation.
            </div>
          ) : (
            <div className="space-y-4">
              {sessions.map((session) => {
                const isExpanded = expandedSession === session.id;
                const messages = sessionMessages[session.id];
                return (
                  <div key={session.id} className="border border-gray-200 dark:border-zinc-800 rounded-xl overflow-hidden">
                    <button
                      onClick={() => { void loadSessionMessages(session.id); }}
                      className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-gray-50 dark:hover:bg-zinc-900/50 transition-colors"
                    >
                      <div className="flex items-center gap-2">
                        <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 shrink-0" />
                        <span className="text-sm text-gray-700 dark:text-zinc-300">Run {formatRelative(session.createdAt)}</span>
                      </div>
                      <span className="text-xs text-gray-400 dark:text-zinc-600 font-mono">{session.id.slice(0, 8)}</span>
                    </button>
                    {isExpanded && messages && (
                      <div className="border-t border-gray-200 dark:border-zinc-800 px-4 py-4 bg-gray-50 dark:bg-zinc-900/30">
                        {messages.filter((m) => m.role === 'assistant' && m.text).map((msg, i) => (
                          <div key={`msg-${String(i)}`} className="text-[13px] text-gray-700 dark:text-zinc-300 prose dark:prose-invert prose-sm max-w-none prose-headings:text-gray-800 dark:prose-headings:text-zinc-200 prose-p:text-gray-700 dark:prose-p:text-zinc-300 prose-code:bg-gray-100 dark:prose-code:bg-zinc-800 prose-code:px-1 prose-code:py-0.5 prose-code:rounded">
                            <Markdown>{msg.text}</Markdown>
                          </div>
                        ))}
                        {messages.filter((m) => m.role === 'assistant' && m.text).length === 0 && (
                          <div className="text-xs text-gray-400 dark:text-zinc-600">No response text captured</div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
