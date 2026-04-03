/**
 * @license
 * Copyright 2025 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import { Link } from 'react-router-dom';
import { Check, X } from 'lucide-react';
import { EnumBadge } from './EnumBadge';
import type { StoreFieldDefinitionInfo } from '@amodalai/react';

export interface FieldRendererProps {
  /** The field schema definition. */
  field: StoreFieldDefinitionInfo;
  /** The field value from the document payload. */
  value: unknown;
  /** Rendering mode: compact for table cells, full for detail cards. */
  mode: 'table' | 'detail';
}

/**
 * Renders a store field value based on its type definition.
 *
 * Table mode: compact, truncated, inline.
 * Detail mode: full, expanded, with nested rendering.
 */
export function FieldRenderer({ field, value, mode }: FieldRendererProps) {
  if (value === null || value === undefined) {
    return <span className="text-muted-foreground">—</span>;
  }

  switch (field.type) {
    case 'string':
      return <StringField value={value} mode={mode} />;
    case 'number':
      return <NumberField value={value} field={field} mode={mode} />;
    case 'boolean':
      return <BooleanField value={value} />;
    case 'datetime':
      return <DatetimeField value={value} mode={mode} />;
    case 'enum':
      return <EnumBadge value={String(value)} />;
    case 'array':
      return <ArrayField value={value} field={field} mode={mode} />;
    case 'object':
      return <ObjectField value={value} field={field} mode={mode} />;
    case 'ref':
      return <RefField value={value} field={field} />;
    default:
      return <span>{String(value)}</span>;
  }
}

function StringField({ value, mode }: { value: unknown; mode: 'table' | 'detail' }) {
  const str = String(value);
  if (mode === 'table' && str.length > 50) {
    return <span title={str}>{str.slice(0, 50)}&hellip;</span>;
  }
  return <span>{str}</span>;
}

function NumberField({
  value,
  field,
  mode,
}: {
  value: unknown;
  field: StoreFieldDefinitionInfo;
  mode: 'table' | 'detail';
}) {
  const num = Number(value);

  // Percentage display for 0-1 range fields
  if (field.min === 0 && field.max === 1) {
    const pct = Math.round(num * 100);
    if (mode === 'table') {
      return <span className="tabular-nums">{pct}%</span>;
    }
    return (
      <div className="flex items-center gap-2">
        <div className="flex-1 h-2 bg-muted rounded-full max-w-[200px]">
          <div
            className="h-2 bg-primary dark:bg-primary rounded-full"
            style={{ width: `${pct}%` }}
          />
        </div>
        <span className="text-sm tabular-nums">{pct}%</span>
      </div>
    );
  }

  return <span className="tabular-nums">{num.toLocaleString()}</span>;
}

function BooleanField({ value }: { value: unknown }) {
  return value ? (
    <Check className="h-4 w-4 text-green-600" />
  ) : (
    <X className="h-4 w-4 text-muted-foreground" />
  );
}

function DatetimeField({ value, mode }: { value: unknown; mode: 'table' | 'detail' }) {
  const date = new Date(String(value));
  const relative = formatRelativeTime(date);

  if (mode === 'table') {
    return <span className="text-muted-foreground" title={date.toISOString()}>{relative}</span>;
  }

  return (
    <div>
      <div>{date.toLocaleString()}</div>
      <div className="text-xs text-muted-foreground">{relative}</div>
    </div>
  );
}

function ArrayField({
  value,
  field,
  mode,
}: {
  value: unknown;
  field: StoreFieldDefinitionInfo;
  mode: 'table' | 'detail';
}) {
  if (!Array.isArray(value)) return <span>{String(value)}</span>;

  if (mode === 'table') {
    return (
      <span className="inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-xs">
        {value.length} item{value.length !== 1 ? 's' : ''}
      </span>
    );
  }

  // Detail mode: render each item
  if (value.length === 0) {
    return <span className="text-muted-foreground">Empty array</span>;
  }

  return (
    <div className="space-y-1">
      {value.map((item, i) => (
        <div key={i} className="pl-3 border-l-2 border-gray-200 dark:border-zinc-700">
          {field.item ? (
            <FieldRenderer field={field.item} value={item} mode="detail" />
          ) : (
            <span>{String(item)}</span>
          )}
        </div>
      ))}
    </div>
  );
}

function ObjectField({
  value,
  field,
  mode,
}: {
  value: unknown;
  field: StoreFieldDefinitionInfo;
  mode: 'table' | 'detail';
}) {
  if (typeof value !== 'object' || value === null) return <span>{String(value)}</span>;

  if (mode === 'table') {
    return <span className="text-muted-foreground">{'{...}'}</span>;
  }

  // Detail mode: render sub-fields if schema defines them
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- value is validated as object above
  const obj = value as Record<string, unknown>;

  if (field.fields) {
    return (
      <div className="border rounded-md divide-y">
        {Object.entries(field.fields).map(([subName, subField]) => (
          <div key={subName} className="px-3 py-2 flex">
            <div className="w-32 text-xs font-medium text-muted-foreground shrink-0">
              {subName}
            </div>
            <div className="flex-1 min-w-0 text-sm">
              <FieldRenderer field={subField} value={obj[subName]} mode="detail" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  // No schema for sub-fields — show JSON
  return (
    <pre className="text-xs whitespace-pre-wrap bg-muted/30 rounded p-2">
      {JSON.stringify(value, null, 2)}
    </pre>
  );
}

function RefField({ value, field }: { value: unknown; field: StoreFieldDefinitionInfo }) {
  const targetStore = field.store;
  if (!targetStore) return <span>{String(value)}</span>;

  return (
    <Link
      to={`/entities/${targetStore}/${String(value)}`}
      className="text-primary dark:text-primary hover:underline"
    >
      {String(value)}
    </Link>
  );
}

/**
 * Format a Date as a relative time string (e.g., "3 min ago", "2 hours ago").
 */
function formatRelativeTime(date: Date): string {
  const now = Date.now();
  const diff = now - date.getTime();

  if (diff < 0) return 'just now';

  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return `${seconds}s ago`;

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;

  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;

  return date.toLocaleDateString();
}
