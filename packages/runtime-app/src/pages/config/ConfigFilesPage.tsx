/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import { useCallback, useEffect, useState } from 'react';
import { ChevronRight, File, FolderOpen, Folder, Save, Package, Loader2, RefreshCw } from 'lucide-react';
import { CodeEditor } from '@/components/CodeEditor';
import { cn } from '@/lib/utils';

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

// Icons by convention directory
function getFileIcon(name: string, dirPath: string): { icon: typeof File; color: string } {
  if (dirPath.startsWith('connections')) return { icon: File, color: 'text-emerald-500/60' };
  if (dirPath.startsWith('skills')) return { icon: File, color: 'text-amber-500/60' };
  if (dirPath.startsWith('knowledge')) return { icon: File, color: 'text-blue-500/60' };
  if (dirPath.startsWith('automations')) return { icon: File, color: 'text-primary/60' };
  if (name === 'config.json') return { icon: File, color: 'text-primary/60' };
  return { icon: File, color: 'text-gray-400' };
}

function getDirIcon(name: string): string {
  switch (name) {
    case 'connections': return 'text-emerald-500/60';
    case 'skills': return 'text-amber-500/60';
    case 'knowledge': return 'text-blue-500/60';
    case 'automations': return 'text-primary/60';
    case 'agents': return 'text-cyan-500/60';
    case 'stores': return 'text-orange-500/60';
    case 'tools': return 'text-rose-500/60';
    case '.amodal': return 'text-primary/60';
    default: return 'text-gray-400';
  }
}

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
        onClick={() => onSelect(entry.path)}
        className={cn(
          'flex items-center gap-2 w-full px-2 py-[5px] rounded text-[12px] text-left transition-colors',
          isSelected
            ? 'bg-primary/10 text-primary'
            : 'text-gray-400 dark:text-white/60 hover:text-gray-700 dark:hover:text-white/90 hover:bg-gray-100 dark:hover:bg-white/[0.03]',
        )}
        style={{ paddingLeft: `${depth * 16 + 8}px` }}
      >
        <FileIcon className={cn('h-3.5 w-3.5 shrink-0', isSelected ? 'text-primary' : color)} />
        <span className="truncate font-mono">{entry.name}</span>
        {entry.source === 'package' && (
          <Package className="h-3 w-3 shrink-0 text-violet-400/50" title={entry.packageName ?? 'installed package'} />
        )}
      </button>
    );
  }

  const dirColor = getDirIcon(entry.name);
  const FolderIcon = open ? FolderOpen : Folder;

  return (
    <div>
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1.5 w-full px-2 py-[5px] rounded text-[12px] text-gray-500 dark:text-white/50 hover:text-gray-800 dark:hover:text-white/80 hover:bg-gray-100 dark:hover:bg-white/[0.03] transition-colors"
        style={{ paddingLeft: `${depth * 16 + 8}px` }}
      >
        <ChevronRight className={cn('h-3 w-3 shrink-0 transition-transform', open && 'rotate-90')} />
        <FolderIcon className={cn('h-3.5 w-3.5 shrink-0', dirColor)} />
        <span className="truncate font-medium">{entry.name}</span>
        {entry.source === 'package' && (
          <Package className="h-3 w-3 shrink-0 text-violet-400/50" title={entry.packageName ?? 'installed package'} />
        )}
        {entry.children && (
          <span className="text-[10px] text-gray-400 dark:text-white/60 ml-auto">{String(entry.children.length)}</span>
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

export function ConfigFilesPage() {
  const [tree, setTree] = useState<FileTreeEntry[]>([]);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [fileData, setFileData] = useState<FileData | null>(null);
  const [editedContent, setEditedContent] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saved' | 'error'>('idle');

  // Fetch file tree (and refresh every 5s to pick up changes from admin agent or hot reload)
  useEffect(() => {
    let lastJson = '';
    const fetchTree = () => {
      fetch('/api/files')
        .then((res) => res.json())
        .then((data: unknown) => {
          const json = JSON.stringify(data);
          if (json !== lastJson) {
            lastJson = json;
            // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- Server response
            const body = data as { tree: FileTreeEntry[] };
            setTree(body.tree);
          }
        })
        .catch(() => {})
        .finally(() => { setLoading(false); });
    };
    fetchTree();
    const interval = setInterval(fetchTree, 5000);
    return () => clearInterval(interval);
  }, []);

  // Fetch file contents when a file is selected
  const selectFile = useCallback((filePath: string) => {
    setSelectedPath(filePath);
    setEditedContent(null);
    setSaveStatus('idle');

    fetch(`/api/files/${filePath}`)
      .then((res) => {
        if (!res.ok) throw new Error('Failed to load');
        return res.json();
      })
      .then((data: unknown) => {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- Server response
        setFileData(data as FileData);
      })
      .catch(() => {
        setFileData(null);
      });
  }, []);

  // Reload the currently selected file from disk
  const reloadFile = useCallback(() => {
    if (!selectedPath) return;
    fetch(`/api/files/${selectedPath}`)
      .then((res) => {
        if (!res.ok) throw new Error('Failed to load');
        return res.json();
      })
      .then((data: unknown) => {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- Server response
        setFileData(data as FileData);
        setEditedContent(null);
      })
      .catch(() => {});
  }, [selectedPath]);

  // Save file
  const saveFile = useCallback(async () => {
    if (!selectedPath || editedContent === null) return;

    setSaving(true);
    setSaveStatus('idle');

    try {
      const res = await fetch(`/api/files/${selectedPath}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: editedContent }),
      });

      if (res.ok) {
        setSaveStatus('saved');
        setFileData((prev) => prev ? { ...prev, content: editedContent } : prev);
        setEditedContent(null);
        // Clear "saved" after 2 seconds
        setTimeout(() => setSaveStatus('idle'), 2000);
      } else {
        setSaveStatus('error');
      }
    } catch {
      setSaveStatus('error');
    }

    setSaving(false);
  }, [selectedPath, editedContent]);

  // Keyboard shortcut: Cmd/Ctrl+S to save
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

  if (loading) {
    return <div className="p-6 text-gray-500 dark:text-zinc-500 text-sm">Loading...</div>;
  }

  return (
    <div className="h-full flex">
      {/* File tree */}
      <div className="w-[240px] border-r border-gray-200 dark:border-white/[0.06] bg-gray-50 dark:bg-[#0c0c14] flex flex-col shrink-0 overflow-hidden">
        <div className="px-3 py-3 border-b border-gray-200 dark:border-white/[0.06]">
          <span className="text-[10px] font-semibold text-gray-400 dark:text-white/45 uppercase tracking-widest">Agent Files</span>
        </div>
        <div className="flex-1 overflow-y-auto scrollbar-thin py-1">
          {tree.map((entry) => (
            <TreeNode key={entry.path} entry={entry} depth={0} selectedPath={selectedPath} onSelect={selectFile} />
          ))}
          {tree.length === 0 && (
            <div className="px-3 py-4 text-xs text-gray-400 dark:text-zinc-600">No files found</div>
          )}
        </div>
      </div>

      {/* Editor */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {selectedPath && fileData ? (
          <>
            {/* Editor header */}
            <div className="h-10 border-b border-gray-200 dark:border-white/[0.06] bg-gray-50 dark:bg-[#0f0f17] flex items-center justify-between px-4 shrink-0">
              <div className="flex items-center gap-2">
                <span className="text-[12px] text-gray-500 dark:text-white/60 font-mono">{selectedPath}</span>
                {fileData?.source === 'package' && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-violet-500/10 text-violet-400 font-medium">package</span>
                )}
                {hasChanges && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-500 font-medium">modified</span>
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
                  onClick={reloadFile}
                  className="h-7 w-7 rounded flex items-center justify-center text-gray-400 dark:text-white/50 hover:text-gray-600 dark:hover:text-white/80 hover:bg-gray-100 dark:hover:bg-white/[0.06] transition-colors"
                  title="Reload file from disk"
                >
                  <RefreshCw className="h-3.5 w-3.5" />
                </button>
                {!isPackageFile && (
                  <button
                    onClick={() => { void saveFile(); }}
                    disabled={!hasChanges || saving}
                    className={cn(
                      'flex items-center gap-1.5 px-3 py-1 rounded text-[12px] font-medium transition-colors',
                      hasChanges
                        ? 'bg-primary-solid text-white hover:bg-primary'
                        : 'bg-gray-200 dark:bg-white/[0.06] text-gray-400 dark:text-white/60 cursor-not-allowed',
                    )}
                  >
                    {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
                    Save
                  </button>
                )}
                {isPackageFile && (
                  <span className="text-[11px] text-gray-400 dark:text-zinc-500">read-only</span>
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
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center">
              <Package className="h-8 w-8 text-gray-300 dark:text-white/10 mx-auto mb-3" />
              <p className="text-sm text-gray-400 dark:text-zinc-600">Select a file to view or edit</p>
              <p className="text-xs text-gray-300 dark:text-zinc-700 mt-1">Changes are saved directly to your repo</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
