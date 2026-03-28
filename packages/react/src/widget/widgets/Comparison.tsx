/**
 * @license
 * Copyright 2025 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import type { WidgetProps } from './WidgetRenderer';

interface ComparisonItem {
  mac: string;
  manufacturer: string;
  protocols: string[];
  zone: string;
  suspicion_score: number;
  tag_status: string;
}

interface ComparisonData {
  items: ComparisonItem[];
  title?: string;
  highlight_differences?: boolean;
}

export function Comparison({ data, sendMessage }: WidgetProps) {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- widget data from LLM
  const d = data as unknown as ComparisonData;

  return (
    <div className="pcw-widget-card pcw-comparison">
      {d.title && <div className="pcw-comparison__title">{d.title}</div>}
      <div className="pcw-comparison__grid">
        {d.items.map((item) => (
          <div key={item.mac} className="pcw-comparison__item">
            <div className="pcw-comparison__mac">{item.mac}</div>
            <div className="pcw-comparison__detail">{item.manufacturer}</div>
            <div className="pcw-comparison__detail">
              {item.protocols.join(', ')}
            </div>
            <div className="pcw-comparison__detail">Zone {item.zone}</div>
            <div className="pcw-comparison__score">Score: {item.suspicion_score}</div>
            <div className="pcw-comparison__detail">Tag: {item.tag_status}</div>
            <button
              type="button"
              className="pcw-entity-card__btn"
              onClick={() => sendMessage(`Investigate device ${item.mac}`)}
            >
              Investigate
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
