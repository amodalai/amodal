/**
 * @license
 * Copyright 2025 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import { useCallback } from 'react';
import type { WidgetProps } from './WidgetRenderer';
import type { InteractionEvent } from '../../events/types';

interface EntityCardData {
  mac: string;
  manufacturer: string;
  protocols: string[];
  zone: string;
  zone_name?: string;
  suspicion_score: number;
  score_factors?: Record<string, number>;
  tag_status: string;
  dwell_time_minutes?: number;
  signal_strength_dbm?: number;
  first_seen?: string;
  last_seen?: string;
}

export function EntityCard({ data, sendMessage, onInteraction }: WidgetProps) {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- widget data from LLM
  const d = data as unknown as EntityCardData;
  const scorePercent = Math.min(100, Math.max(0, d.suspicion_score));

  const handleMouseEnter = useCallback(() => {
    const event: InteractionEvent = {
      type: 'entity_hovered',
      entity: { entityType: 'device', entityId: d.mac, source: 'widget:entity-card' },
      timestamp: new Date().toISOString(),
    };
    onInteraction?.(event);
  }, [d.mac, onInteraction]);

  const handleMouseLeave = useCallback(() => {
    const event: InteractionEvent = {
      type: 'entity_unhovered',
      entity: { entityType: 'device', entityId: d.mac, source: 'widget:entity-card' },
      timestamp: new Date().toISOString(),
    };
    onInteraction?.(event);
  }, [d.mac, onInteraction]);

  const handleClick = useCallback(() => {
    const event: InteractionEvent = {
      type: 'entity_clicked',
      entity: { entityType: 'device', entityId: d.mac, source: 'widget:entity-card' },
      timestamp: new Date().toISOString(),
    };
    onInteraction?.(event);
  }, [d.mac, onInteraction]);

  return (
    <div
      className="pcw-widget-card pcw-entity-card"
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      onClick={handleClick}
      data-testid="entity-card"
    >
      <div className="pcw-entity-card__header">
        <span className="pcw-entity-card__mac">{d.mac}</span>
        <span className="pcw-entity-card__mfr">{d.manufacturer}</span>
      </div>
      {Array.isArray(d.protocols) && d.protocols.length > 0 && (
        <div className="pcw-entity-card__protocols">
          {d.protocols.map((p) => (
            <span key={p} className="pcw-entity-card__protocol-badge">{p}</span>
          ))}
        </div>
      )}
      <div className="pcw-entity-card__zone">
        Zone {d.zone}{d.zone_name ? ` (${d.zone_name})` : ''}
      </div>
      <div className="pcw-score-bar">
        <div className="pcw-score-bar__label">
          Score: {d.suspicion_score}
        </div>
        <div className="pcw-score-bar__track">
          <div
            className="pcw-score-bar__fill"
            style={{ width: `${String(scorePercent)}%` }}
          />
        </div>
      </div>
      {d.score_factors && Object.keys(d.score_factors).length > 0 && (
        <div className="pcw-entity-card__factors">
          {Object.entries(d.score_factors).map(([key, val]) => (
            <div key={key} className="pcw-entity-card__factor">
              <span>{key.replace(/_/g, ' ')}</span>
              <span>+{val}</span>
            </div>
          ))}
        </div>
      )}
      <div className="pcw-entity-card__meta">
        <span>Tag: {d.tag_status}</span>
        {d.dwell_time_minutes != null && <span>Dwell: {d.dwell_time_minutes}min</span>}
      </div>
      <div className="pcw-entity-card__actions">
        <button
          type="button"
          className="pcw-entity-card__btn"
          onClick={() => sendMessage(`Investigate device ${d.mac} in Zone ${d.zone}`)}
        >
          Investigate
        </button>
        <button
          type="button"
          className="pcw-entity-card__btn pcw-entity-card__btn--secondary"
          onClick={() => sendMessage(`Tag device ${d.mac} as suspicious`)}
        >
          Tag
        </button>
      </div>
    </div>
  );
}
