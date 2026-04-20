/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import { useState, useEffect, useCallback } from 'react';
import { Brain, Plus, Trash2, Pencil, X, Check, AlertCircle } from 'lucide-react';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MEMORY_API_BASE = '/api/memory';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface MemoryEntry {
  id: string;
  appId: string;
  content: string;
  category: string | null;
  createdAt: string;
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export function MemoryPage() {
  const [entries, setEntries] = useState<MemoryEntry[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [newContent, setNewContent] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editContent, setEditContent] = useState('');
  const [saving, setSaving] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const fetchEntries = useCallback(() => {
    fetch(MEMORY_API_BASE, { signal: AbortSignal.timeout(5_000) })
      .then((r) => {
        if (!r.ok) throw new Error(`Request failed: ${String(r.status)}`);
        // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- JSON response boundary
        return r.json() as Promise<{ entries: MemoryEntry[] }>;
      })
      .then((d) => setEntries(d.entries))
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => setLoaded(true));
  }, []);

  useEffect(() => {
    fetchEntries();
  }, [fetchEntries]);

  const handleAdd = async () => {
    if (!newContent.trim() || saving) return;
    setSaving(true);
    setActionError(null);
    try {
      const res = await fetch(MEMORY_API_BASE, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: newContent.trim() }),
        signal: AbortSignal.timeout(5_000),
      });
      if (!res.ok) throw new Error(`Failed to add entry (${String(res.status)})`);
      setNewContent('');
      fetchEntries();
    } catch (err: unknown) {
      setActionError(err instanceof Error ? err.message : 'Failed to add entry');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    setActionError(null);
    try {
      const res = await fetch(`${MEMORY_API_BASE}/${id}`, {
        method: 'DELETE',
        signal: AbortSignal.timeout(5_000),
      });
      if (!res.ok) throw new Error(`Failed to delete entry (${String(res.status)})`);
      fetchEntries();
    } catch (err: unknown) {
      setActionError(err instanceof Error ? err.message : 'Failed to delete entry');
    }
  };

  const handleEditSave = async () => {
    if (!editingId || !editContent.trim() || saving) return;
    setSaving(true);
    setActionError(null);
    try {
      const res = await fetch(`${MEMORY_API_BASE}/${editingId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: editContent.trim() }),
        signal: AbortSignal.timeout(5_000),
      });
      if (!res.ok) throw new Error(`Failed to save edit (${String(res.status)})`);
      setEditingId(null);
      setEditContent('');
      fetchEntries();
    } catch (err: unknown) {
      setActionError(err instanceof Error ? err.message : 'Failed to save edit');
    } finally {
      setSaving(false);
    }
  };

  const startEdit = (entry: MemoryEntry) => {
    setEditingId(entry.id);
    setEditContent(entry.content);
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditContent('');
  };

  if (!loaded) return null;
  if (error) {
    return (
      <div className="text-center py-16">
        <p className="text-sm text-muted-foreground">Failed to load memory: {error}</p>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-xl font-semibold text-foreground">Memory</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Persistent facts the agent remembers across sessions. Add, edit, or remove entries.
        </p>
      </div>

      {/* Action error banner */}
      {actionError && (
        <div className="mb-4 flex items-center gap-2 p-3 text-sm text-red-600 bg-red-50 dark:text-red-400 dark:bg-red-950/30 border border-red-200 dark:border-red-900 rounded-lg">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>{actionError}</span>
          <button onClick={() => setActionError(null)} className="ml-auto p-0.5 hover:opacity-70">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Add new entry */}
      <div className="mb-6 flex gap-2">
        <input
          type="text"
          value={newContent}
          onChange={(e) => setNewContent(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') void handleAdd(); }}
          placeholder="Add a memory entry..."
          className="flex-1 px-3 py-2 text-sm bg-card border border-border rounded-lg text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/20"
        />
        <button
          onClick={() => void handleAdd()}
          disabled={!newContent.trim() || saving}
          className="px-3 py-2 text-sm font-medium bg-primary-solid text-white rounded-lg hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1.5"
        >
          <Plus className="w-4 h-4" />
          Add
        </button>
      </div>

      {/* Entry list */}
      <div className="space-y-2">
        {entries.map((entry) => (
          <div
            key={entry.id}
            className="group flex items-start gap-3 p-3 bg-card border border-border rounded-lg"
          >
            {editingId === entry.id ? (
              /* Edit mode */
              <div className="flex-1 flex items-center gap-2">
                <input
                  type="text"
                  value={editContent}
                  onChange={(e) => setEditContent(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void handleEditSave();
                    if (e.key === 'Escape') cancelEdit();
                  }}
                  className="flex-1 px-2 py-1 text-sm bg-muted border border-border rounded text-foreground focus:outline-none focus:ring-2 focus:ring-primary/20"
                  autoFocus
                />
                <button
                  onClick={() => void handleEditSave()}
                  disabled={saving}
                  className="p-1 text-emerald-500 hover:text-emerald-400"
                >
                  <Check className="w-4 h-4" />
                </button>
                <button
                  onClick={cancelEdit}
                  className="p-1 text-muted-foreground hover:text-foreground"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            ) : (
              /* Display mode */
              <>
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-foreground">{entry.content}</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    {new Date(entry.createdAt).toLocaleDateString()} &middot; {entry.id.slice(0, 8)}
                  </p>
                </div>
                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button
                    onClick={() => startEdit(entry)}
                    className="p-1.5 text-muted-foreground hover:text-foreground rounded"
                    title="Edit"
                  >
                    <Pencil className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={() => void handleDelete(entry.id)}
                    className="p-1.5 text-muted-foreground hover:text-red-500 rounded"
                    title="Delete"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </>
            )}
          </div>
        ))}

        {entries.length === 0 && (
          <div className="text-center py-16 border border-border border-dashed rounded-lg">
            <Brain className="w-8 h-8 text-muted-foreground mx-auto mb-3" />
            <p className="text-sm text-muted-foreground">No memories yet.</p>
            <p className="text-xs text-muted-foreground mt-1">
              The agent saves facts, preferences, and corrections here as you chat.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
