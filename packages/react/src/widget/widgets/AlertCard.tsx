/**
 * @license
 * Copyright 2025 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import type { WidgetProps } from './WidgetRenderer';

interface AlertCardData {
  id: string;
  type: string;
  zone: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  description: string;
  involved_devices: string[];
  protocols_involved?: string[];
  detected_at: string;
}

const SEVERITY_CLASSES: Record<string, string> = {
  low: 'pcw-alert-card__severity--low',
  medium: 'pcw-alert-card__severity--medium',
  high: 'pcw-alert-card__severity--high',
  critical: 'pcw-alert-card__severity--critical',
};

export function AlertCard({ data, sendMessage }: WidgetProps) {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- widget data from LLM
  const d = data as unknown as AlertCardData;

  return (
    <div className="pcw-widget-card pcw-alert-card">
      <div className="pcw-alert-card__header">
        <span className={`pcw-alert-card__severity ${SEVERITY_CLASSES[d.severity] ?? ''}`}>
          {d.severity.toUpperCase()}
        </span>
        <span className="pcw-alert-card__type">{d.type.replace(/_/g, ' ')}</span>
        <span className="pcw-alert-card__zone">Zone {d.zone}</span>
      </div>
      <p className="pcw-alert-card__description">{d.description}</p>
      <div className="pcw-alert-card__devices">
        {d.involved_devices.map((mac) => (
          <button
            key={mac}
            type="button"
            className="pcw-alert-card__device-link"
            onClick={() => sendMessage(`Tell me about device ${mac}`)}
          >
            {mac}
          </button>
        ))}
      </div>
      {d.protocols_involved && d.protocols_involved.length > 0 && (
        <div className="pcw-alert-card__protocols">
          {d.protocols_involved.map((p) => (
            <span key={p} className="pcw-entity-card__protocol-badge">{p}</span>
          ))}
        </div>
      )}
      <div className="pcw-alert-card__time">
        {new Date(d.detected_at).toLocaleString()}
      </div>
    </div>
  );
}
