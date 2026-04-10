/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

/**
 * DiffView — line-based unified diff renderer.
 *
 * Used by the deploy confirmation modal and (eventually) by individual file
 * editors to show "what changed since last deploy". Line-based is sufficient
 * for the actual use cases (markdown skill prompts, knowledge docs, JSON
 * config files) without pulling in a heavyweight diff library.
 */

import { computeLineDiff, type DiffLine } from '../utils/lineDiff';

interface DiffViewProps {
  before: string;
  after: string;
  /** Optional file path label, shown above the diff. */
  filePath?: string;
  /** Maximum lines to render before showing a truncation marker. */
  maxLines?: number;
}

/** Default cap on how many diff lines to render in the UI. */
const DEFAULT_MAX_LINES = 200;

export function DiffView({ before, after, filePath, maxLines = DEFAULT_MAX_LINES }: DiffViewProps) {
  const lines = computeLineDiff(before, after);

  if (lines.length === 0) {
    return (
      <div className="rounded-md border border-border bg-card p-3 text-xs text-muted-foreground">
        {filePath && <div className="mb-1 font-mono">{filePath}</div>}
        No changes
      </div>
    );
  }

  const truncated = lines.length > maxLines;
  const visibleLines = truncated ? lines.slice(0, maxLines) : lines;
  const hiddenCount = lines.length - visibleLines.length;

  return (
    <div className="overflow-hidden rounded-md border border-border bg-card">
      {filePath && (
        <div className="border-b border-border bg-muted px-3 py-1.5 font-mono text-xs text-muted-foreground">
          {filePath}
        </div>
      )}
      <pre className="overflow-x-auto p-2 text-xs leading-snug">
        {visibleLines.map((line, i) => (
          <DiffLineRow key={i} line={line} />
        ))}
        {truncated && (
          <div className="mt-1 text-center text-[10px] text-muted-foreground italic">
            ... {hiddenCount} more line{hiddenCount === 1 ? '' : 's'}
          </div>
        )}
      </pre>
    </div>
  );
}

function DiffLineRow({ line }: { line: DiffLine }) {
  // Semantic colors per CLAUDE.md: emerald for adds, red for deletes,
  // muted for context. Diff backgrounds use the standard /10 alpha pattern.
  switch (line.type) {
    case 'add':
      return (
        <div className="flex bg-emerald-500/10 text-emerald-700 dark:text-emerald-400">
          <span className="w-6 shrink-0 select-none text-right pr-1">+</span>
          <span className="flex-1 whitespace-pre-wrap break-words">{line.text}</span>
        </div>
      );
    case 'remove':
      return (
        <div className="flex bg-red-500/10 text-red-700 dark:text-red-400">
          <span className="w-6 shrink-0 select-none text-right pr-1">-</span>
          <span className="flex-1 whitespace-pre-wrap break-words">{line.text}</span>
        </div>
      );
    case 'truncated':
      return (
        <div className="bg-amber-500/10 px-2 py-2 text-center text-xs italic text-amber-600 dark:text-amber-400">
          {line.text}
        </div>
      );
    case 'context':
      return (
        <div className="flex text-muted-foreground">
          <span className="w-6 shrink-0 select-none text-right pr-1"> </span>
          <span className="flex-1 whitespace-pre-wrap break-words">{line.text}</span>
        </div>
      );
    default: {
      // Exhaustiveness check — adding a new DiffLineType causes a compile error here.
      const _exhaustive: never = line.type;
      void _exhaustive;
      return null;
    }
  }
}
