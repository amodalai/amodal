/**
 * @license
 * Copyright 2025 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import { useState } from 'react';
import type { WidgetProps } from './WidgetRenderer';

interface EntityEntry {
  mac: string;
  manufacturer: string;
  protocols: string[];
  zone: string;
  suspicion_score: number;
  tag_status: string;
}

interface EntityListData {
  devices: EntityEntry[];
  title?: string;
  sort?: string;
  max_display?: number;
}

export function EntityList({ data, sendMessage }: WidgetProps) {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- widget data from LLM
  const d = data as unknown as EntityListData;
  const [expanded, setExpanded] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState(d.sort ?? 'suspicion_score');

  const sorted = [...d.devices].sort((a, b) => {
    if (sortKey === 'suspicion_score') return b.suspicion_score - a.suspicion_score;
    if (sortKey === 'mac') return a.mac.localeCompare(b.mac);
    if (sortKey === 'zone') return a.zone.localeCompare(b.zone);
    return 0;
  });

  const displayCount = d.max_display ?? sorted.length;
  const visible = sorted.slice(0, displayCount);

  return (
    <div className="pcw-widget-card pcw-entity-list">
      {d.title && <div className="pcw-entity-list__title">{d.title}</div>}
      <div className="pcw-entity-list__sort">
        Sort:
        {['suspicion_score', 'mac', 'zone'].map((key) => (
          <button
            key={key}
            type="button"
            className={`pcw-entity-list__sort-btn ${sortKey === key ? 'pcw-entity-list__sort-btn--active' : ''}`}
            onClick={() => setSortKey(key)}
          >
            {key.replace(/_/g, ' ')}
          </button>
        ))}
      </div>
      <table className="pcw-data-table__table">
        <thead>
          <tr>
            <th>MAC</th>
            <th>Mfr</th>
            <th>Zone</th>
            <th>Score</th>
            <th>Tag</th>
          </tr>
        </thead>
        <tbody>
          {visible.map((device) => (
            <tr
              key={device.mac}
              className={`pcw-entity-list__row ${expanded === device.mac ? 'pcw-entity-list__row--expanded' : ''}`}
              onClick={() => setExpanded(expanded === device.mac ? null : device.mac)}
            >
              <td className="pcw-entity-list__mac">{device.mac}</td>
              <td>{device.manufacturer}</td>
              <td>{device.zone}</td>
              <td>{device.suspicion_score}</td>
              <td>{device.tag_status}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {expanded && (
        <div className="pcw-entity-list__detail">
          <button
            type="button"
            className="pcw-entity-card__btn"
            onClick={() => sendMessage(`Tell me more about device ${expanded}`)}
          >
            Investigate {expanded}
          </button>
        </div>
      )}
      {sorted.length > displayCount && (
        <div className="pcw-entity-list__more">
          +{sorted.length - displayCount} more devices
        </div>
      )}
    </div>
  );
}
