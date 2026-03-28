/**
 * @license
 * Copyright 2025 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import type { WidgetProps } from './WidgetRenderer';

interface StatusItem {
  id: string;
  label: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  status: string;
  description?: string;
  updated_at?: string;
}

interface StatusBoardData {
  title?: string;
  items: StatusItem[];
}

const SEVERITY_ORDER: Record<string, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
};

export function StatusBoard({ data, sendMessage }: WidgetProps) {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- widget data from LLM
  const d = data as unknown as StatusBoardData;

  const sorted = [...d.items].sort(
    (a, b) => (SEVERITY_ORDER[a.severity] ?? 4) - (SEVERITY_ORDER[b.severity] ?? 4),
  );

  return (
    <div className="pcw-widget-card pcw-status-board">
      {d.title && <div className="pcw-status-board__title">{d.title}</div>}
      <div className="pcw-status-board__items">
        {sorted.map((item) => (
          <div
            key={item.id}
            className={`pcw-status-board__item pcw-status-board__item--${item.severity}`}
            onClick={() => sendMessage(`Tell me more about ${item.label}`)}
            style={{ cursor: 'pointer' }}
          >
            <div className="pcw-status-board__item-header">
              <span className={`pcw-status-board__severity pcw-status-board__severity--${item.severity}`}>
                {item.severity.toUpperCase()}
              </span>
              <span className="pcw-status-board__item-label">{item.label}</span>
              <span className="pcw-status-board__item-status">{item.status}</span>
            </div>
            {item.description && (
              <div className="pcw-status-board__item-desc">{item.description}</div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
