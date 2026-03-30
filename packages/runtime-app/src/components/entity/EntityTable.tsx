/**
 * @license
 * Copyright 2025 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import { useNavigate } from 'react-router-dom';
import type { StoreFieldDefinitionInfo, StoreDocument } from '@amodalai/react';
import { EnumBadge } from './EnumBadge';

export interface EntityTableProps {
  storeName: string;
  schema: Record<string, StoreFieldDefinitionInfo>;
  keyTemplate: string;
  documents: StoreDocument[];
  total: number;
  onSortChange?: (sort: string) => void;
  onFilterChange?: (filter: Record<string, unknown>) => void;
}

function formatDateRelative(value: unknown): string {
  const date = new Date(String(value));
  const diff = Date.now() - date.getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${String(mins)}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${String(hours)}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${String(days)}d ago`;
  return date.toLocaleDateString();
}

/** Pick the most useful fields to show in the card. */
function pickDisplayFields(
  schema: Record<string, StoreFieldDefinitionInfo>,
  keyField: string,
): { title: string | null; badges: string[]; textFields: string[]; dateField: string | null } {
  const fields = Object.entries(schema);
  let title: string | null = null;
  const badges: string[] = [];
  const textFields: string[] = [];
  let dateField: string | null = null;

  for (const [name, field] of fields) {
    if (name === keyField) continue;
    if (field.type === 'enum') { badges.push(name); continue; }
    if (field.type === 'datetime' && !dateField) { dateField = name; continue; }
    if (!title && field.type === 'string' && ['title', 'name', 'summary', 'subject'].includes(name)) {
      title = name;
      continue;
    }
    if (field.type === 'string') { textFields.push(name); }
  }

  if (!title && textFields.length > 0) {
    title = textFields.shift() ?? null;
  }

  return { title, badges, textFields: textFields.slice(0, 2), dateField };
}

export function EntityTable({
  storeName,
  schema,
  keyTemplate,
  documents,
  total,
}: EntityTableProps) {
  const navigate = useNavigate();
  const keyField = keyTemplate.replace(/[{}]/g, '');
  const display = pickDisplayFields(schema, keyField);

  if (documents.length === 0) {
    return (
      <div className="text-center py-16 text-gray-400 dark:text-zinc-600 text-sm">
        No documents yet.
      </div>
    );
  }

  return (
    <div>
      <div className="space-y-2">
        {documents.map((doc) => {
          const payload = doc.payload;
          const titleValue = display.title ? String(payload[display.title] ?? doc.key) : doc.key;

          return (
            <div
              key={doc.key}
              onClick={() => { void navigate(`/entities/${storeName}/${doc.key}`); }}
              className="border border-gray-200 dark:border-zinc-800 rounded-xl p-4 cursor-pointer hover:bg-gray-50 dark:hover:bg-zinc-900/50 transition-colors"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-gray-900 dark:text-zinc-200 mb-1">
                    {titleValue}
                  </div>

                  {display.textFields.map((name) => {
                    const val = payload[name];
                    if (!val) return null;
                    const str = String(val);
                    return (
                      <div key={name} className="text-xs text-gray-500 dark:text-zinc-400 mb-1.5 line-clamp-2">
                        {str.length > 150 ? str.slice(0, 150) + '...' : str}
                      </div>
                    );
                  })}

                  {display.badges.length > 0 && (
                    <div className="flex items-center gap-1.5 flex-wrap mt-1">
                      {display.badges.map((name) => {
                        const val = payload[name];
                        if (!val) return null;
                        return <EnumBadge key={name} value={String(val)} />;
                      })}
                    </div>
                  )}
                </div>

                <div className="flex flex-col items-end gap-1 shrink-0">
                  <span className="text-[11px] font-mono text-gray-400 dark:text-zinc-600">{doc.key}</span>
                  {display.dateField && payload[display.dateField] && (
                    <span className="text-[11px] text-gray-400 dark:text-zinc-600">
                      {formatDateRelative(payload[display.dateField])}
                    </span>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {total > documents.length && (
        <div className="mt-4 text-center text-xs text-gray-400 dark:text-zinc-600">
          Showing {documents.length} of {total.toLocaleString()}
        </div>
      )}
    </div>
  );
}
