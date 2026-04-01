/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import {existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync} from 'node:fs';
import {join, resolve} from 'node:path';
import {randomUUID} from 'node:crypto';

export interface FeedbackEntry {
  id: string;
  sessionId: string;
  messageId: string;
  rating: 'up' | 'down';
  comment?: string;
  query: string;
  response: string;
  toolCalls?: string[];
  model?: string;
  timestamp: string;
  reviewedAt?: string;
}

export interface FeedbackSummary {
  total: number;
  thumbsUp: number;
  thumbsDown: number;
  recentDown: FeedbackEntry[];
}

/**
 * Persists user feedback (thumbs up/down) to disk.
 * Files stored in .amodal/feedback/ under the repo root.
 */
export class FeedbackStore {
  private readonly dir: string;

  constructor(repoPath: string) {
    this.dir = join(repoPath, '.amodal', 'feedback');
  }

  private ensureDir(): void {
    if (!existsSync(this.dir)) {
      mkdirSync(this.dir, {recursive: true});
    }
  }

  private resolvePath(id: string): string | null {
    const trimmed = id.trim();
    if (trimmed.length === 0 || trimmed.length > 128) return null;
    if (!/^[A-Za-z0-9_-]+$/.test(trimmed)) return null;
    const resolved = resolve(this.dir, `${trimmed}.json`);
    if (!resolved.startsWith(resolve(this.dir) + '/')) return null;
    return resolved;
  }

  save(entry: Omit<FeedbackEntry, 'id' | 'timestamp'>): FeedbackEntry {
    const full: FeedbackEntry = {
      ...entry,
      id: randomUUID(),
      timestamp: new Date().toISOString(),
    };
    const file = this.resolvePath(full.id);
    if (!file) throw new Error('Invalid feedback ID');
    this.ensureDir();
    writeFileSync(file, JSON.stringify(full, null, 2));
    return full;
  }

  list(limit = 100): FeedbackEntry[] {
    if (!existsSync(this.dir)) return [];
    const files = readdirSync(this.dir).filter((f) => f.endsWith('.json'));
    const entries: FeedbackEntry[] = [];

    for (const file of files) {
      try {
        const raw: unknown = JSON.parse(readFileSync(join(this.dir, file), 'utf-8'));
        entries.push(raw as FeedbackEntry); // eslint-disable-line @typescript-eslint/no-unsafe-type-assertion -- trusted local file
      } catch {
        // Skip corrupt files
      }
    }

    return entries
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
      .slice(0, limit);
  }

  summary(): FeedbackSummary {
    const all = this.list(1000);
    const thumbsUp = all.filter((e) => e.rating === 'up').length;
    const thumbsDown = all.filter((e) => e.rating === 'down').length;
    const unreviewedDown = all.filter((e) => e.rating === 'down' && !e.reviewedAt);
    const recentDown = unreviewedDown.slice(0, 20);

    return {
      total: all.length,
      thumbsUp,
      thumbsDown,
      recentDown,
    };
  }

  /** Mark feedback entries as reviewed so they're excluded from the next synthesis. */
  markReviewed(ids: string[]): void {
    const now = new Date().toISOString();
    for (const id of ids) {
      const file = this.resolvePath(id);
      if (!file || !existsSync(file)) continue;
      try {
        const raw: unknown = JSON.parse(readFileSync(file, 'utf-8'));
        // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- trusted local file
        const entry = raw as FeedbackEntry;
        entry.reviewedAt = now;
        writeFileSync(file, JSON.stringify(entry, null, 2));
      } catch {
        // Skip
      }
    }
  }
}
