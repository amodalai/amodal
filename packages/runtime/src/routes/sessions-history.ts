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
  toolCalls?: Array<{toolId: string; toolName: string; parameters: Record<string, unknown>}>;
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
      const title = typeof s.metadata['title'] === 'string' ? s.metadata['title'] : undefined;
      return {
        id: s.id,
        app_id: typeof s.metadata['appId'] === 'string' ? s.metadata['appId'] : appId,
        title: title ?? extractFirstUserText(s.messages) ?? 'Untitled',
        tags: extractStringArray(s.metadata['tags']),
        status: 'active',
        message_count: s.messages.length,
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
    const title = typeof persisted.metadata['title'] === 'string' ? persisted.metadata['title'] : undefined;
    const rawMessages = persisted.messages.map(flattenModelMessage).filter((m) => m !== null);
    const messages = rawMessages.map((m) => ({
      type: m.role === 'user' ? 'user' : 'assistant_text',
      id: `hist-${Math.random().toString(36).slice(2)}`,
      text: m.text,
      timestamp: persisted.updatedAt.toISOString(),
      ...(m.toolCalls ? {toolCalls: m.toolCalls} : {}),
    }));
    res.json({
      id: persisted.id,
      app_id: typeof persisted.metadata['appId'] === 'string' ? persisted.metadata['appId'] : appId,
      title: title ?? extractFirstUserText(persisted.messages) ?? 'Untitled',
      tags: extractStringArray(persisted.metadata['tags']),
      status: 'active',
      message_count: persisted.messages.length,
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
