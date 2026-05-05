/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

/**
 * Session history REST routes.
 *
 * Provides GET/PATCH/DELETE for /sessions/history endpoints.
 * Used by both local-server and hosted runtime via createServer.
 */

import {Router} from 'express';
import type {Request, Response} from 'express';
import type {SessionStore} from '../session/store.js';
import type {StandaloneSessionManager} from '../session/manager.js';
import type {RuntimeEventBus} from '../events/event-bus.js';
import {asyncHandler} from './route-helpers.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface HistoryMessage {
  role: string;
  text: string;
  toolCalls?: Array<{toolId: string; toolName: string; parameters: Record<string, unknown>; result?: unknown}>;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const SUMMARY_EXCERPT_MAX = 80;

function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null && !Array.isArray(x);
}

function isTextPart(part: unknown): part is {type: 'text'; text: string} {
  return isRecord(part) && part['type'] === 'text' && typeof part['text'] === 'string';
}

function isToolCallPart(part: unknown): part is {
  type: 'tool-call';
  toolCallId: string;
  toolName: string;
  input?: unknown;
} {
  return (
    isRecord(part) &&
    part['type'] === 'tool-call' &&
    typeof part['toolCallId'] === 'string' &&
    typeof part['toolName'] === 'string'
  );
}

function isToolResultPart(part: unknown): part is {type: 'tool-result'; toolCallId: string; output?: unknown} {
  return (
    isRecord(part) &&
    part['type'] === 'tool-result' &&
    typeof part['toolCallId'] === 'string'
  );
}

function getMessageRole(raw: unknown): string | null {
  if (!isRecord(raw)) return null;
  const role = raw['role'];
  return typeof role === 'string' ? role : null;
}

function getMessageContent(raw: unknown): unknown {
  if (!isRecord(raw)) return undefined;
  return raw['content'];
}

function excerpt(s: string): string {
  return s.length > SUMMARY_EXCERPT_MAX ? `${s.slice(0, SUMMARY_EXCERPT_MAX)}…` : s;
}

function extractStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === 'string');
}

function extractFirstUserText(messages: readonly unknown[]): string | undefined {
  for (const raw of messages) {
    if (getMessageRole(raw) !== 'user') continue;
    const content = getMessageContent(raw);
    if (typeof content === 'string') return excerpt(content);
    if (Array.isArray(content)) {
      const firstText = content.find(isTextPart);
      if (firstText) return excerpt(firstText.text);
    }
  }
  return undefined;
}

function flattenModelMessage(raw: unknown): HistoryMessage | null {
  const role = getMessageRole(raw);
  if (role !== 'user' && role !== 'assistant') return null;

  const content = getMessageContent(raw);
  if (typeof content === 'string') {
    return {role, text: content};
  }
  if (Array.isArray(content)) {
    const text = content.filter(isTextPart).map((p) => p.text).join('');
    const toolCalls = role === 'assistant'
      ? content.filter(isToolCallPart).map((p) => ({
        toolId: p.toolCallId,
        toolName: p.toolName,
        parameters: isRecord(p.input) ? p.input : {},
      }))
      : [];
    if (text.length === 0 && toolCalls.length === 0) return null;
    return toolCalls.length > 0 ? {role, text, toolCalls} : {role, text};
  }
  return null;
}

function attachToolResults(messages: HistoryMessage[], rawMessages: readonly unknown[]): HistoryMessage[] {
  const callsById = new Map<string, NonNullable<HistoryMessage['toolCalls']>[number]>();
  for (const msg of messages) {
    for (const call of msg.toolCalls ?? []) {
      callsById.set(call.toolId, call);
    }
  }

  for (const raw of rawMessages) {
    if (getMessageRole(raw) !== 'tool') continue;
    const content = getMessageContent(raw);
    if (!Array.isArray(content)) continue;
    for (const part of content) {
      if (!isToolResultPart(part)) continue;
      const call = callsById.get(part.toolCallId);
      if (call) call.result = part.output;
    }
  }

  return messages;
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export interface SessionsHistoryRouterOptions {
  sessionStore: SessionStore;
  sessionManager: StandaloneSessionManager;
  eventBus: RuntimeEventBus;
  appId: string;
}

const SESSION_LIST_LIMIT = 500;

export function createSessionsHistoryRouter(options: SessionsHistoryRouterOptions): Router {
  const {sessionStore, sessionManager, eventBus, appId} = options;
  const router = Router();

  // List sessions
  router.get('/sessions/history', asyncHandler(async (_req: Request, res: Response) => {
    const filter = {appId};
    const {sessions: rows} = await sessionStore.list({limit: SESSION_LIST_LIMIT, filter});
    const items = rows.map((s) => {
      const meta = s.metadata;
      return {
        id: s.id,
        app_id: meta.appId ?? appId,
        scope_id: s.scopeId,
        title: meta.title ?? extractFirstUserText(s.messages) ?? 'Untitled',
        tags: extractStringArray(meta['tags']),
        status: 'active',
        message_count: s.messages.length,
        token_usage: {
          input_tokens: s.tokenUsage.inputTokens,
          output_tokens: s.tokenUsage.outputTokens,
          total_tokens: s.tokenUsage.totalTokens,
        },
        model: meta.model ?? null,
        provider: meta.provider ?? null,
        created_at: s.createdAt.toISOString(),
        updated_at: s.updatedAt.toISOString(),
      };
    });
    res.json(items);
  }));

  // Get single session with messages
  router.get('/sessions/history/:id', asyncHandler(async (req: Request, res: Response) => {
    const persisted = await sessionStore.load(req.params['id'] ?? '');
    if (!persisted) {
      res.status(404).json({error: 'Session not found'});
      return;
    }
    const meta = persisted.metadata;
    if ((meta.appId ?? appId) !== appId) {
      res.status(404).json({error: 'Session not found'});
      return;
    }
    const rawMessages = persisted.messages.map(flattenModelMessage).filter((m) => m !== null);
    const messages = attachToolResults(rawMessages, persisted.messages).map((m, index) => ({
      role: m.role,
      type: m.role === 'user' ? 'user' : 'assistant_text',
      id: `hist-${String(index)}`,
      text: m.text,
      timestamp: persisted.updatedAt.toISOString(),
      ...(m.toolCalls ? {toolCalls: m.toolCalls} : {}),
    }));
    res.json({
      id: persisted.id,
      app_id: meta.appId ?? appId,
      scope_id: persisted.scopeId,
      title: meta.title ?? extractFirstUserText(persisted.messages) ?? 'Untitled',
      tags: extractStringArray(meta['tags']),
      status: 'active',
      message_count: persisted.messages.length,
      token_usage: {
        input_tokens: persisted.tokenUsage.inputTokens,
        output_tokens: persisted.tokenUsage.outputTokens,
        total_tokens: persisted.tokenUsage.totalTokens,
      },
      model: meta.model ?? null,
      provider: meta.provider ?? null,
      metadata: meta,
      created_at: persisted.createdAt.toISOString(),
      updated_at: persisted.updatedAt.toISOString(),
      messages,
    });
  }));

  // Rename session
  router.patch('/sessions/history/:id', asyncHandler(async (req: Request, res: Response) => {
    const sessionId = req.params['id'] ?? '';
    const body: unknown = req.body;
    if (!body || typeof body !== 'object') {
      res.status(400).json({error: 'Request body required'});
      return;
    }
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- validated above: body is a non-null object
    const updates = body as Record<string, unknown>;
    const live = sessionManager.get(sessionId);
    if (live) {
      if (typeof updates['title'] === 'string') live.metadata.title = updates['title'];
      if (Array.isArray(updates['tags'])) live.metadata['tags'] = updates['tags'];
      await sessionManager.persist(live);
    } else {
      const persisted = await sessionStore.load(sessionId);
      if (!persisted) {
        res.status(404).json({error: 'Session not found'});
        return;
      }
      if (typeof updates['title'] === 'string') persisted.metadata.title = updates['title'];
      if (Array.isArray(updates['tags'])) persisted.metadata['tags'] = updates['tags'];
      persisted.updatedAt = new Date();
      await sessionStore.save(persisted);
    }
    eventBus.emit({type: 'session_updated', sessionId, appId, title: typeof updates['title'] === 'string' ? updates['title'] : undefined});
    res.json({ok: true});
  }));

  // Aggregate stats for the dashboard
  router.get('/api/stats', asyncHandler(async (_req: Request, res: Response) => {
    const filter = {appId};
    const {sessions: rows} = await sessionStore.list({limit: SESSION_LIST_LIMIT, filter});

    let inputTokens = 0;
    let outputTokens = 0;
    let totalTokens = 0;
    let lastActive: Date | null = null;
    const modelCounts = new Map<string, {sessions: number; inputTokens: number; outputTokens: number; totalTokens: number}>();

    for (const s of rows) {
      inputTokens += s.tokenUsage.inputTokens;
      outputTokens += s.tokenUsage.outputTokens;
      totalTokens += s.tokenUsage.totalTokens;
      if (!lastActive || s.updatedAt > lastActive) lastActive = s.updatedAt;

      const model = s.metadata.model ?? 'unknown';
      const existing = modelCounts.get(model);
      if (existing) {
        existing.sessions += 1;
        existing.inputTokens += s.tokenUsage.inputTokens;
        existing.outputTokens += s.tokenUsage.outputTokens;
        existing.totalTokens += s.tokenUsage.totalTokens;
      } else {
        modelCounts.set(model, {
          sessions: 1,
          inputTokens: s.tokenUsage.inputTokens,
          outputTokens: s.tokenUsage.outputTokens,
          totalTokens: s.tokenUsage.totalTokens,
        });
      }
    }

    const topModels = [...modelCounts.entries()]
      .sort((a, b) => b[1].totalTokens - a[1].totalTokens)
      .map(([model, counts]) => ({model, ...counts}));

    res.json({
      sessions: rows.length,
      tokens: {input: inputTokens, output: outputTokens, total: totalTokens},
      lastActive: lastActive?.toISOString() ?? null,
      topModels,
    });
  }));

  // Delete session
  router.delete('/sessions/history/:id', asyncHandler(async (req: Request, res: Response) => {
    const sessionId = req.params['id'] ?? '';
    await sessionManager.destroy(sessionId);
    const deleted = await sessionStore.delete(sessionId);
    if (!deleted) {
      res.status(404).json({error: 'Session not found'});
      return;
    }
    eventBus.emit({type: 'session_deleted', sessionId});
    res.json({ok: true});
  }));

  return router;
}
