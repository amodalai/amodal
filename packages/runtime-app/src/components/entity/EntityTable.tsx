/**
 * @license
 * Copyright 2025 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import { useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import type { StoreFieldDefinitionInfo, StoreDocument } from '@amodalai/react';
import { FieldRenderer } from './FieldRenderer';
import { ChevronUp, ChevronDown } from 'lucide-react';

export interface EntityTableProps {
  storeName: string;
  schema: Record<string, StoreFieldDefinitionInfo>;
  keyTemplate: string;
  documents: StoreDocument[];
  total: number;
  onSortChange?: (sort: string) => void;
  onFilterChange?: (filter: Record<string, unknown>) => void;
}

export function EntityTable({
  storeName,
  schema,
  keyTemplate,
  documents,
  total,
  onSortChange,
  onFilterChange,
}: EntityTableProps) {
  const navigate = useNavigate();
  const fields = Object.entries(schema);
  const [currentSort, setCurrentSort] = useState<string>('');
  const [enumFilters, setEnumFilters] = useState<Record<string, string>>({});

  const keyField = keyTemplate.replace(/[{}]/g, '');

  const handleSort = useCallback(
    (fieldName: string) => {
      const newSort = currentSort === fieldName ? `-${fieldName}` : fieldName;
      setCurrentSort(newSort);
      onSortChange?.(newSort);
    },
    [currentSort, onSortChange],
  );

  const handleEnumFilter = useCallback(
    (fieldName: string, value: string) => {
      const next = { ...enumFilters };
      if (value === '') {
        delete next[fieldName];
      } else {
        next[fieldName] = value;
      }
      setEnumFilters(next);
      onFilterChange?.(next);
    },
    [enumFilters, onFilterChange],
  );

  return (
    <div className="bg-white border border-gray-200 rounded-lg overflow-hidden shadow-sm">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-200 bg-gray-50/80">
              {fields.map(([name, _field]) => (
                <th
                  key={name}
                  className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:text-gray-700 select-none transition-colors"
                  onClick={() => handleSort(name)}
                >
                  <span className="inline-flex items-center gap-1">
                    {name}
                    {currentSort === name && <ChevronUp className="h-3 w-3" />}
                    {currentSort === `-${name}` && <ChevronDown className="h-3 w-3" />}
                  </span>
                </th>
              ))}
            </tr>

            {/* Enum filter row */}
            {fields.some(([, f]) => f.type === 'enum') && (
              <tr className="border-b border-gray-100 bg-gray-50/40">
                {fields.map(([name, field]) => (
                  <th key={name} className="px-4 py-1.5">
                    {field.type === 'enum' && field.values ? (
                      <select
                        className="text-xs bg-white border border-gray-200 rounded px-1.5 py-1 w-full focus:outline-none focus:ring-1 focus:ring-indigo-500 focus:border-indigo-500 transition-colors"
                        value={enumFilters[name] ?? ''}
                        onChange={(e) => handleEnumFilter(name, e.target.value)}
                      >
                        <option value="">All</option>
                        {field.values.map((v) => (
                          <option key={v} value={v}>{v}</option>
                        ))}
                      </select>
                    ) : null}
                  </th>
                ))}
              </tr>
            )}
          </thead>

          <tbody className="divide-y divide-gray-100">
            {documents.map((doc) => {
              const rowKey = String(doc.payload[keyField] ?? doc.key);
              return (
                <tr
                  key={doc.key}
                  className="hover:bg-indigo-50/40 cursor-pointer transition-colors duration-100"
                  onClick={() => navigate(`/entities/${storeName}/${rowKey}`)}
                >
                  {fields.map(([name, field]) => (
                    <td key={name} className="px-4 py-3 max-w-[220px]">
                      <FieldRenderer field={field} value={doc.payload[name]} mode="table" />
                    </td>
                  ))}
                </tr>
              );
            })}

            {documents.length === 0 && (
              <tr>
                <td
                  colSpan={fields.length}
                  className="px-4 py-16 text-center text-gray-400 text-sm"
                >
                  No documents yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {total > 0 && (
        <div className="px-4 py-2.5 border-t border-gray-100 bg-gray-50/50 text-xs text-gray-500">
          Showing {documents.length} of {total.toLocaleString()} document{total !== 1 ? 's' : ''}
        </div>
      )}
    </div>
  );
}
