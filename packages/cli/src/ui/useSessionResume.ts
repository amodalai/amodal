/**
 * @license
 * Copyright 2025 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import {useState, useEffect} from 'react';
import http from 'node:http';
import https from 'node:https';
import type {ChatMessage, SessionMessage} from './types.js';

let nextResumeId = 0;
function genResumeId(): string {
  return `resume-${++nextResumeId}`;
}

/**
 * Convert server SessionMessage[] to ChatMessage[].
 */
export function convertSessionMessages(
  sessionMessages: SessionMessage[],
): ChatMessage[] {
  return sessionMessages.map((msg) => ({
    id: genResumeId(),
    role: msg.role,
    text: msg.text,
    toolCalls: msg.tool_calls?.map((tc) => ({
      toolId: tc.tool_id,
      toolName: tc.tool_name,
      args: tc.args,
      status: tc.status,
      result: tc.result,
      error: tc.error,
      durationMs: tc.duration_ms,
    })),
    skills: msg.skills,
    thinking: msg.thinking,
  }));
}

export interface UseSessionResumeResult {
  messages: ChatMessage[] | null;
  loading: boolean;
  error: string | null;
}

/**
 * Fetches a session from the runtime server and converts messages.
 */
export function useSessionResume(
  sessionId: string | null,
  baseUrl: string,
): UseSessionResumeResult {
  const [messages, setMessages] = useState<ChatMessage[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!sessionId) return;

    setLoading(true);
    setError(null);

    const url = new URL(`/session/${encodeURIComponent(sessionId)}`, baseUrl);
    const mod = url.protocol === 'https:' ? https : http;
    const req = mod.request(
      url,
      { method: 'GET' },
      (res) => {
        let data = '';
        res.setEncoding('utf8');
        res.on('data', (chunk: string) => {
          data += chunk;
        });
        res.on('end', () => {
          try {
            // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
            const parsed = JSON.parse(data) as {
              session_id: string;
              messages: SessionMessage[];
            };
            const converted = convertSessionMessages(parsed.messages);
            setMessages(converted);
          } catch {
            setError('Failed to parse session data');
          } finally {
            setLoading(false);
          }
        });
      },
    );

    req.on('error', (err) => {
      setError(err.message);
      setLoading(false);
    });

    req.end();
  }, [sessionId, baseUrl]);

  return {messages, loading, error};
}
