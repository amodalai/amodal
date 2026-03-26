/**
 * @license
 * Copyright 2025 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import { useCallback } from 'react';
import type { WidgetProps } from './WidgetRenderer';
import type { InteractionEvent } from '../../events/types';

interface ScopeMapData {
  highlight_zones?: string[];
  highlight_devices?: string[];
  label?: string;
  show_all_devices?: boolean;
}

const ZONE_POSITIONS: Record<string, { x: number; y: number; w: number; h: number }> = {
  A: { x: 10, y: 10, w: 80, h: 60 },
  B: { x: 100, y: 10, w: 80, h: 60 },
  C: { x: 190, y: 10, w: 80, h: 60 },
  D: { x: 10, y: 80, w: 125, h: 60 },
  E: { x: 145, y: 80, w: 125, h: 60 },
};

const ZONE_LABELS: Record<string, string> = {
  A: 'Lobby',
  B: 'Offices',
  C: 'Server Room',
  D: 'Warehouse',
  E: 'Parking',
};

export function ScopeMap({ data, onInteraction }: WidgetProps) {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- widget data from LLM
  const d = data as unknown as ScopeMapData;
  const highlighted = new Set(d.highlight_zones ?? []);

  const emitZoneInteraction = useCallback(
    (type: 'entity_hovered' | 'entity_unhovered' | 'entity_clicked', zoneId: string) => {
      const event: InteractionEvent = {
        type,
        entity: { entityType: 'zone', entityId: zoneId, source: 'widget:scope-map' },
        timestamp: new Date().toISOString(),
      };
      onInteraction?.(event);
    },
    [onInteraction],
  );

  const emitDeviceInteraction = useCallback(
    (type: 'entity_hovered' | 'entity_unhovered' | 'entity_clicked', mac: string) => {
      const event: InteractionEvent = {
        type,
        entity: { entityType: 'device', entityId: mac, source: 'widget:scope-map' },
        timestamp: new Date().toISOString(),
      };
      onInteraction?.(event);
    },
    [onInteraction],
  );

  return (
    <div className="pcw-widget-card pcw-scope-map">
      {d.label && <div className="pcw-scope-map__label">{d.label}</div>}
      <svg viewBox="0 0 280 150" className="pcw-scope-map__svg">
        {Object.entries(ZONE_POSITIONS).map(([zoneId, pos]) => (
          <g key={zoneId}>
            <rect
              x={pos.x}
              y={pos.y}
              width={pos.w}
              height={pos.h}
              rx={4}
              className={highlighted.has(zoneId)
                ? 'pcw-scope-map__zone pcw-scope-map__zone--highlight'
                : 'pcw-scope-map__zone'}
              data-testid={`zone-${zoneId}`}
              onMouseEnter={() => emitZoneInteraction('entity_hovered', zoneId)}
              onMouseLeave={() => emitZoneInteraction('entity_unhovered', zoneId)}
              onClick={() => emitZoneInteraction('entity_clicked', zoneId)}
              style={{ cursor: 'pointer' }}
            />
            <text
              x={pos.x + pos.w / 2}
              y={pos.y + pos.h / 2 - 6}
              textAnchor="middle"
              className="pcw-scope-map__zone-label"
              style={{ pointerEvents: 'none' }}
            >
              Zone {zoneId}
            </text>
            <text
              x={pos.x + pos.w / 2}
              y={pos.y + pos.h / 2 + 8}
              textAnchor="middle"
              className="pcw-scope-map__zone-name"
              style={{ pointerEvents: 'none' }}
            >
              {ZONE_LABELS[zoneId] ?? ''}
            </text>
          </g>
        ))}
      </svg>
      {d.highlight_devices && d.highlight_devices.length > 0 && (
        <div className="pcw-scope-map__devices">
          {d.highlight_devices.map((mac) => (
            <span
              key={mac}
              className="pcw-scope-map__device-badge"
              data-testid={`device-badge-${mac}`}
              onMouseEnter={() => emitDeviceInteraction('entity_hovered', mac)}
              onMouseLeave={() => emitDeviceInteraction('entity_unhovered', mac)}
              onClick={() => emitDeviceInteraction('entity_clicked', mac)}
              style={{ cursor: 'pointer' }}
            >
              {mac}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
