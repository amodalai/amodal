/**
 * @license
 * Copyright 2025 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import { useCallback, useState } from 'react';
import type { SessionHistoryItem } from '../client';
import { TagEditor } from './TagEditor';

export interface SessionHistoryProps {
  sessions: SessionHistoryItem[];
  isLoading: boolean;
  allTags: string[];
  onSelectSession: (sessionId: string) => void;
  onNewChat: () => void;
  onClose: () => void;
  onUpdateTags: (sessionId: string, tags: string[]) => void;
}

function timeAgo(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diff = now - then;
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${String(minutes)}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${String(hours)}h ago`;
  const days = Math.floor(hours / 24);
  return `${String(days)}d ago`;
}

export function SessionHistory({
  sessions,
  isLoading,
  allTags,
  onSelectSession,
  onNewChat,
  onClose,
  onUpdateTags,
}: SessionHistoryProps) {
  const [filterTags, setFilterTags] = useState<string[]>([]);
  const [editingTagsId, setEditingTagsId] = useState<string | null>(null);

  const toggleFilter = useCallback((tag: string) => {
    setFilterTags((prev) =>
      prev.includes(tag)
        ? prev.filter((t) => t !== tag)
        : [...prev, tag],
    );
  }, []);

  const filteredSessions =
    filterTags.length > 0
      ? sessions.filter((s) => filterTags.some((tag) => s.tags.includes(tag)))
      : sessions;

  return (
    <div className="pcw-history-drawer" data-testid="session-history">
      <div className="pcw-history-header">
        <h3 className="pcw-history-title">Session History</h3>
        <button
          type="button"
          className="pcw-history-close"
          onClick={onClose}
          aria-label="Close history"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} width={16} height={16}>
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>

      <button
        type="button"
        className="pcw-history-new-chat"
        onClick={onNewChat}
      >
        + New Chat
      </button>

      {allTags.length > 0 && (
        <div className="pcw-history-filters">
          {allTags.map((tag) => (
            <button
              key={tag}
              type="button"
              className={`pcw-filter-chip ${filterTags.includes(tag) ? 'pcw-filter-chip--active' : ''}`}
              onClick={() => toggleFilter(tag)}
            >
              {tag}
            </button>
          ))}
        </div>
      )}

      <div className="pcw-history-list">
        {isLoading && (
          <div className="pcw-history-loading">Loading sessions...</div>
        )}

        {!isLoading && filteredSessions.length === 0 && (
          <div className="pcw-history-empty">No past sessions</div>
        )}

        {filteredSessions.map((session) => (
          <div
            key={session.id}
            className="pcw-history-item"
          >
            <button
              type="button"
              className="pcw-history-item-content"
              onClick={() => onSelectSession(session.id)}
            >
              <div className="pcw-history-item-title">
                {session.title ?? `Session ${session.id.slice(0, 8)}`}
              </div>
              <div className="pcw-history-item-meta">
                <span className="pcw-history-item-time">{timeAgo(session.created_at)}</span>
                <span className="pcw-history-item-count">
                  {String(session.message_count)} msg{session.message_count !== 1 ? 's' : ''}
                </span>
              </div>
            </button>

            <div className="pcw-history-item-tags">
              {editingTagsId === session.id ? (
                <TagEditor
                  tags={session.tags}
                  onSave={(tags) => {
                    onUpdateTags(session.id, tags);
                    setEditingTagsId(null);
                  }}
                />
              ) : (
                <div className="pcw-history-item-tag-list">
                  {session.tags.map((tag) => (
                    <span key={tag} className="pcw-tag-badge pcw-tag-badge--small">{tag}</span>
                  ))}
                  <button
                    type="button"
                    className="pcw-tag-edit-btn"
                    onClick={(e) => {
                      e.stopPropagation();
                      setEditingTagsId(session.id);
                    }}
                    aria-label="Edit tags"
                  >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} width={12} height={12}>
                      <path d="M20.59 13.41l-7.17 7.17a2 2 0 01-2.83 0L2 12V2h10l8.59 8.59a2 2 0 010 2.82z" />
                      <line x1="7" y1="7" x2="7.01" y2="7" />
                    </svg>
                  </button>
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
