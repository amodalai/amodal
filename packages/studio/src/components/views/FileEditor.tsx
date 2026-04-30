/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

/**
 * FileEditor — interactive file tree + code editor for agent configuration files.
 *
 * - File content fetched from the runtime via the Studio server proxy
 * - Drafts saved via useDraftWorkspace (same-origin to the Studio API)
 * - Tree refetch via polling on `store_updated` events (Studio SSE)
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronRight, File, FolderOpen, Folder, Save, Package, Loader2, RefreshCw } from 'lucide-react';
import { CodeEditor } from '@/components/CodeEditor';
import { DraftWorkspaceBar } from '@/components/studio/DraftWorkspaceBar';
import { useDraftWorkspace } from '@/hooks/useDraftWorkspace';
import { useStudioEvents } from '@/contexts/StudioEventsContext';
import { runtimeApiUrl } from '@/lib/api';
import { createBrowserLogger } from '@/lib/browser-logger';
import { cn } from '@/lib/utils';

const log = createBrowserLogger('FileEditor');

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface FileTreeEntry {
  name: string;
  path: string;
  type: 'file' | 'directory';
  children?: FileTreeEntry[];
  source?: 'local' | 'package';
  packageName?: string;
}

interface FileData {
  path: string;
  content: string;
  language: string;
  source?: 'local' | 'package';
}

// ---------------------------------------------------------------------------
// Tree node helpers
// ---------------------------------------------------------------------------

function getFileIcon(_name: string, dirPath: string): { icon: typeof File; color: string } {
  if (dirPath.startsWith('connections')) return { icon: File, color: 'text-emerald-500/60' };
  if (dirPath.startsWith('skills')) return { icon: File, color: 'text-amber-500/60' };
  if (dirPath.startsWith('knowledge')) return { icon: File, color: 'text-blue-500/60' };
  if (dirPath.startsWith('automations')) return { icon: File, color: 'text-primary/60' };
  if (dirPath.includes('config.json')) return { icon: File, color: 'text-primary/60' };
  return { icon: File, color: 'text-muted-foreground/60' };
}

function getDirColor(name: string): string {
  switch (name) {
    case 'connections': return 'text-emerald-500/60';
    case 'skills': return 'text-amber-500/60';
    case 'knowledge': return 'text-blue-500/60';
    case 'automations': return 'text-primary/60';
    case 'agents': return 'text-cyan-500/60';
    case 'stores': return 'text-orange-500/60';
    case 'tools': return 'text-rose-500/60';
    case '.amodal': return 'text-primary/60';
    default: return 'text-muted-foreground/60';
  }
}

// ---------------------------------------------------------------------------
// TreeNode component
// ---------------------------------------------------------------------------

function TreeNode({ entry, depth, selectedPath, onSelect }: {
  entry: FileTreeEntry;
  depth: number;
  selectedPath: string | null;
  onSelect: (path: string) => void;
}) {
  const [open, setOpen] = useState(depth < 1);

  if (entry.type === 'file') {
    const { icon: FileIcon, color } = getFileIcon(entry.name, entry.path);
    const isSelected = selectedPath === entry.path;

    return (
      <button
        type="button"
        onClick={() => onSelect(entry.path)}
        className={cn(
          'flex items-center gap-2 w-full px-2 py-[5px] rounded text-[12px] text-left transition-colors',
          isSelected
            ? 'bg-primary/10 text-primary'
            : 'text-muted-foreground hover:text-foreground hover:bg-muted',
        )}
        style={{ paddingLeft: `${String(depth * 16 + 8)}px` }}
      >
        <FileIcon className={cn('h-3.5 w-3.5 shrink-0', isSelected ? 'text-primary' : color)} />
        <span className="truncate font-mono">{entry.name}</span>
        {entry.source === 'package' && (
          <span title={entry.packageName ?? 'installed package'}>
            <Package className="h-3 w-3 shrink-0 text-violet-400/50" />
          </span>
        )}
      </button>
    );
  }

  const dirColor = getDirColor(entry.name);
  const FolderIcon = open ? FolderOpen : Folder;

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1.5 w-full px-2 py-[5px] rounded text-[12px] text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
        style={{ paddingLeft: `${String(depth * 16 + 8)}px` }}
      >
        <ChevronRight className={cn('h-3 w-3 shrink-0 transition-transform', open && 'rotate-90')} />
        <FolderIcon className={cn('h-3.5 w-3.5 shrink-0', dirColor)} />
        <span className="truncate font-medium">{entry.name}</span>
        {entry.source === 'package' && (
          <span title={entry.packageName ?? 'installed package'}>
            <Package className="h-3 w-3 shrink-0 text-violet-400/50" />
          </span>
        )}
        {entry.children && (
          <span className="text-[10px] text-muted-foreground/60 ml-auto">{String(entry.children.length)}</span>
        )}
      </button>
      {open && entry.children && (
        <div>
          {entry.children.map((child) => (
            <TreeNode key={child.path} entry={child} depth={depth + 1} selectedPath={selectedPath} onSelect={onSelect} />
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// FileEditor
// ---------------------------------------------------------------------------

export function FileEditor({ initialTree }: { initialTree: FileTreeEntry[] }) {
  const [tree, setTree] = useState<FileTreeEntry[]>(initialTree);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [fileData, setFileData] = useState<FileData | null>(null);
  const [editedContent, setEditedContent] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saved' | 'error'>('idle');
  const workspace = useDraftWorkspace();
  const lastTreeJsonRef = useRef('');

  // -----------------------------------------------------------------------
  // Fetch tree via proxy
  // -----------------------------------------------------------------------

  const fetchTree = useCallback(() => {
    fetch(runtimeApiUrl('/api/files'), { signal: AbortSignal.timeout(5_000) })
      .then((res) => {
        if (!res.ok) throw new Error(`Tree fetch returned ${String(res.status)}`);
        return res.json();
      })
      .then((data: unknown) => {
        const json = JSON.stringify(data);
        if (json !== lastTreeJsonRef.current) {
          lastTreeJsonRef.current = json;
          // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- Server response boundary
          const body = data as { tree: FileTreeEntry[] };
          setTree(body.tree);
        }
      })
      .catch((err: unknown) => {
        log.warn('tree_fetch_failed', { error: err instanceof Error ? err.message : String(err) });
      });
  }, []);

  // Refetch tree when studio events indicate file changes.
  // Studio SSE currently emits store_updated for file operations.
  useStudioEvents(['store_updated'], () => {
    fetchTree();
  });

  // -----------------------------------------------------------------------
  // File selection
  // -----------------------------------------------------------------------

  const selectFile = useCallback((filePath: string) => {
    setSelectedPath(filePath);
    setEditedContent(null);
    setSaveStatus('idle');
    setLoading(true);

    fetch(runtimeApiUrl(`/api/files/${encodeURIComponent(filePath)}`), {
      signal: AbortSignal.timeout(5_000),
    })
      .then((res) => {
        if (!res.ok) throw new Error(`File fetch returned ${String(res.status)}`);
        return res.json();
      })
      .then((data: unknown) => {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- Server response boundary
        setFileData(data as FileData);
      })
      .catch((err: unknown) => {
        log.warn('file_fetch_failed', { filePath, error: err instanceof Error ? err.message : String(err) });
        setFileData(null);
      })
      .finally(() => {
        setLoading(false);
      });
  }, []);

  // -----------------------------------------------------------------------
  // Reload current file
  // -----------------------------------------------------------------------

  const reloadFile = useCallback(() => {
    if (!selectedPath) return;
    fetch(runtimeApiUrl(`/api/files/${encodeURIComponent(selectedPath)}`), {
      signal: AbortSignal.timeout(5_000),
    })
      .then((res) => {
        if (!res.ok) throw new Error(`Reload returned ${String(res.status)}`);
        return res.json();
      })
      .then((data: unknown) => {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- Server response boundary
        setFileData(data as FileData);
        setEditedContent(null);
      })
      .catch((err: unknown) => {
        log.warn('file_reload_failed', { selectedPath, error: err instanceof Error ? err.message : String(err) });
      });
  }, [selectedPath]);

  // -----------------------------------------------------------------------
  // Save — creates a draft via useDraftWorkspace
  // -----------------------------------------------------------------------

  const saveFile = useCallback(async () => {
    if (!selectedPath || editedContent === null) return;

    setSaving(true);
    setSaveStatus('idle');

    try {
      await workspace.saveDraft(selectedPath, editedContent);
      const err = workspace.getLatestError();
      if (err) {
        setSaveStatus('error');
      } else {
        setSaveStatus('saved');
        setFileData((prev) => prev ? { ...prev, content: editedContent } : prev);
        setEditedContent(null);
        window.setTimeout(() => setSaveStatus('idle'), 2_000);
      }
    } catch {
      setSaveStatus('error');
    }

    setSaving(false);
  }, [selectedPath, editedContent, workspace]);

  // -----------------------------------------------------------------------
  // Keyboard shortcut: Cmd/Ctrl+S
  // -----------------------------------------------------------------------

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault();
        void saveFile();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [saveFile]);

  const hasChanges = editedContent !== null && fileData !== null && editedContent !== fileData.content;
  const isPackageFile = fileData?.source === 'package';

  // The files page needs to fill the entire content area. Break out of the
  // parent's max-w / padding wrapper applied in StudioShell.
  return (
    <div className="-mx-6 -my-6 h-[calc(100vh)] flex">
      {/* File tree sidebar */}
      <div className="w-[240px] border-r border-border bg-card flex flex-col shrink-0 overflow-hidden">
        <div className="px-3 py-3 border-b border-border">
          <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest">
            Agent Files
          </span>
        </div>
        <div className="flex-1 overflow-y-auto scrollbar-thin py-1">
          {tree.map((entry) => (
            <TreeNode key={entry.path} entry={entry} depth={0} selectedPath={selectedPath} onSelect={selectFile} />
          ))}
          {tree.length === 0 && (
            <div className="px-3 py-4 text-xs text-muted-foreground">No files found</div>
          )}
        </div>
      </div>

      {/* Editor pane */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {loading && (
          <div className="flex-1 flex items-center justify-center">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        )}

        {!loading && selectedPath && fileData ? (
          <>
            {/* Editor header */}
            <div className="h-10 border-b border-border bg-card flex items-center justify-between px-4 shrink-0">
              <div className="flex items-center gap-2">
                <span className="text-[12px] text-muted-foreground font-mono">{selectedPath}</span>
                {fileData.source === 'package' && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-violet-500/10 text-violet-400 font-medium">
                    package
                  </span>
                )}
                {hasChanges && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-500 font-medium">
                    modified
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2">
                {saveStatus === 'saved' && (
                  <span className="text-[11px] text-emerald-500">Saved</span>
                )}
                {saveStatus === 'error' && (
                  <span className="text-[11px] text-red-500">Save failed</span>
                )}
                <button
                  type="button"
                  onClick={reloadFile}
                  className="h-7 w-7 rounded flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                  title="Reload file from disk"
                >
                  <RefreshCw className="h-3.5 w-3.5" />
                </button>
                {!isPackageFile && (
                  <button
                    type="button"
                    onClick={() => { void saveFile(); }}
                    disabled={!hasChanges || saving}
                    className={cn(
                      'flex items-center gap-1.5 px-3 py-1 rounded text-[12px] font-medium transition-colors',
                      hasChanges
                        ? 'bg-primary-solid text-white hover:bg-primary'
                        : 'bg-muted text-muted-foreground cursor-not-allowed',
                    )}
                  >
                    {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
                    Save
                  </button>
                )}
                {isPackageFile && (
                  <span className="text-[11px] text-muted-foreground">read-only</span>
                )}
              </div>
            </div>

            {/* Editor body */}
            <div className="flex-1 overflow-hidden">
              <CodeEditor
                value={fileData.content}
                language={fileData.language}
                onChange={isPackageFile ? undefined : setEditedContent}
                readOnly={isPackageFile}
              />
            </div>

            {/* Draft workspace bar */}
            <DraftWorkspaceBar workspace={workspace} />
          </>
        ) : null}

        {!loading && !selectedPath && (
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center">
              <Package className="h-8 w-8 text-muted-foreground/30 mx-auto mb-3" />
              <p className="text-sm text-muted-foreground">Select a file to view or edit</p>
              <p className="text-xs text-muted-foreground/60 mt-1">
                Changes are saved as drafts — publish when ready
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
