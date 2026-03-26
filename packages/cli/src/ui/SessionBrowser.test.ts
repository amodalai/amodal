/**
 * @license
 * Copyright 2025 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import {describe, it, expect} from 'vitest';
import type {SessionEntry} from './SessionBrowser.js';

// Test the filtering logic independently
function filterSessions(
  sessions: SessionEntry[],
  filter: string,
): SessionEntry[] {
  if (!filter) return sessions;
  return sessions.filter(
    (s) =>
      s.id.includes(filter) ||
      s.preview.toLowerCase().includes(filter.toLowerCase()),
  );
}

describe('SessionBrowser filtering', () => {
  const sessions: SessionEntry[] = [
    {id: 'abc123', createdAt: '2025-01-01', messageCount: 5, preview: 'What is the error rate?'},
    {id: 'def456', createdAt: '2025-01-02', messageCount: 3, preview: 'Deploy status check'},
    {id: 'ghi789', createdAt: '2025-01-03', messageCount: 8, preview: 'Error investigation'},
  ];

  it('returns all sessions with empty filter', () => {
    expect(filterSessions(sessions, '')).toHaveLength(3);
  });

  it('filters by id', () => {
    const result = filterSessions(sessions, 'abc');
    expect(result).toHaveLength(1);
    expect(result[0]?.id).toBe('abc123');
  });

  it('filters by preview text (case-insensitive)', () => {
    const result = filterSessions(sessions, 'error');
    expect(result).toHaveLength(2);
  });

  it('returns empty for no matches', () => {
    const result = filterSessions(sessions, 'zzz');
    expect(result).toHaveLength(0);
  });
});
