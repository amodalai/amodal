/**
 * @license
 * Copyright 2025 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import { useState, useCallback } from 'react';
import type { WidgetProps } from './WidgetRenderer';

interface DataTableColumn {
  key: string;
  label: string;
}

interface DataTableData {
  columns: DataTableColumn[];
  rows: Array<Record<string, unknown>>;
  title?: string;
  sortable?: boolean;
}

export function DataTable({ data }: WidgetProps) {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- widget data from LLM
  const d = data as unknown as Partial<DataTableData>;
  const columns = d.columns ?? [];
  const rows = d.rows ?? [];
  const [sortCol, setSortCol] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');

  const handleSort = useCallback(
    (key: string) => {
      if (!d.sortable) return;
      if (sortCol === key) {
        setSortDir((prev) => (prev === 'asc' ? 'desc' : 'asc'));
      } else {
        setSortCol(key);
        setSortDir('asc');
      }
    },
    [d.sortable, sortCol],
  );

  const sortedRows = sortCol
    ? [...rows].sort((a, b) => {
        const aVal = a[sortCol];
        const bVal = b[sortCol];
        if (typeof aVal === 'number' && typeof bVal === 'number') {
          return sortDir === 'asc' ? aVal - bVal : bVal - aVal;
        }
        const aStr = String(aVal ?? '');
        const bStr = String(bVal ?? '');
        return sortDir === 'asc' ? aStr.localeCompare(bStr) : bStr.localeCompare(aStr);
      })
    : rows;

  return (
    <div className="pcw-widget-card pcw-data-table">
      {d.title && <div className="pcw-data-table__title">{d.title}</div>}
      <div className="pcw-data-table__scroll">
        <table className="pcw-data-table__table">
          <thead>
            <tr>
              {columns.map((col) => (
                <th
                  key={col.key}
                  onClick={() => handleSort(col.key)}
                  className={d.sortable ? 'pcw-data-table__sortable' : ''}
                >
                  {col.label}
                  {sortCol === col.key && (sortDir === 'asc' ? ' ▲' : ' ▼')}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sortedRows.map((row, i) => (
              <tr key={String(i)}>
                {columns.map((col) => (
                  <td key={col.key}>{String(row[col.key] ?? '')}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
