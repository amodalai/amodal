/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import {existsSync, mkdirSync, readFileSync, readdirSync, unlinkSync, writeFileSync} from 'node:fs';
import {join, resolve} from 'node:path';
import type {AgentSession} from './agent-types.js';

interface PersistedSession {
  id: string;
  appId: string;
  title?: string;
  conversationHistory: unknown[];
  createdAt: number;
  lastAccessedAt: number;
  automationName?: string;
}

/**
 * Persists session conversation history to disk.
 * Sessions are stored as JSON files in .amodal/sessions/ under the repo root.
 */
export class SessionStore {
  private readonly dir: string;

  constructor(repoPath: string) {
    this.dir = join(repoPath, '.amodal', 'sessions');
  }

  private ensureDir(): void {
    if (!existsSync(this.dir)) {
      mkdirSync(this.dir, {recursive: true});
    }
  }

  /**
   * Resolve a session ID to a safe file path within the sessions directory.
   * Returns the full path if valid, null if the ID is suspicious.
   */
  private resolvePath(sessionId: string): string | null {
    const trimmed = sessionId.trim();
    if (trimmed.length === 0 || trimmed.length > 128) return null;
    if (!/^[A-Za-z0-9_-]+$/.test(trimmed)) return null;
    const resolved = resolve(this.dir, `${trimmed}.json`);
    // Ensure the resolved path is still inside the sessions directory
    if (!resolved.startsWith(resolve(this.dir) + '/')) return null;
    return resolved;
  }

  /**
   * Save a session's conversation history to disk.
   */
  save(session: AgentSession, automationName?: string): void {
    const file = this.resolvePath(session.id);
    if (!file) return;
    this.ensureDir();
    const data: PersistedSession = {
      id: session.id,
      appId: session.appId,
      title: session.title,
      conversationHistory: session.conversationHistory,
      createdAt: session.createdAt,
      lastAccessedAt: session.lastAccessedAt,
      automationName,
    };
    writeFileSync(file, JSON.stringify(data, null, 2));
  }

  /**
   * Load a session's persisted data by ID.
   */
  load(sessionId: string): PersistedSession | null {
    const file = this.resolvePath(sessionId);
    if (!file) return null;
    if (!existsSync(file)) return null;
    try {
      const raw: unknown = JSON.parse(readFileSync(file, 'utf-8'));
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- Trusted local file we wrote
      return raw as PersistedSession;
    } catch {
      return null;
    }
  }

  /**
   * List all persisted sessions, newest first.
   */
  list(): Array<{id: string; appId: string; title?: string; createdAt: number; lastAccessedAt: number; summary: string; automationName?: string}> {
    if (!existsSync(this.dir)) return [];
    const files = readdirSync(this.dir).filter((f) => f.endsWith('.json'));
    const sessions: Array<{id: string; appId: string; title?: string; createdAt: number; lastAccessedAt: number; summary: string; automationName?: string}> = [];

    for (const file of files) {
      try {
        const raw: unknown = JSON.parse(readFileSync(join(this.dir, file), 'utf-8'));
        // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- Trusted local file we wrote
        const data = raw as PersistedSession;
        // Use title if set, otherwise extract first user message
        let summary = 'Untitled';
        if (data.title) {
          summary = data.title;
        } else {
          const isUserMsg = (m: unknown): m is {role: 'user'; content: string} =>
            typeof m === 'object' && m !== null && 'role' in m && 'content' in m &&
            (m as Record<string, unknown>)['role'] === 'user' && typeof (m as Record<string, unknown>)['content'] === 'string';
          const firstUserMsg = data.conversationHistory.find(isUserMsg);
          if (firstUserMsg) summary = firstUserMsg.content.slice(0, 80);
        }
        sessions.push({
          id: data.id,
          appId: data.appId,
          title: data.title,
          createdAt: data.createdAt,
          lastAccessedAt: data.lastAccessedAt,
          summary,
          automationName: data.automationName,
        });
      } catch {
        // Skip corrupt files
      }
    }

    return sessions.sort((a, b) => b.lastAccessedAt - a.lastAccessedAt);
  }

  /**
   * Update a session's title.
   */
  updateTitle(sessionId: string, title: string): boolean {
    const file = this.resolvePath(sessionId);
    if (!file || !existsSync(file)) return false;
    const raw: unknown = JSON.parse(readFileSync(file, 'utf-8'));
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- Trusted local file we wrote
    const data = raw as PersistedSession;
    data.title = title;
    writeFileSync(file, JSON.stringify(data, null, 2));
    return true;
  }

  /**
   * Delete a session file.
   */
  delete(sessionId: string): boolean {
    const file = this.resolvePath(sessionId);
    if (!file || !existsSync(file)) return false;
    unlinkSync(file);
    return true;
  }

  /**
   * Get the most recent session ID.
   */
  latest(): string | null {
    const sessions = this.list();
    return sessions.length > 0 ? sessions[0].id : null;
  }
}
