/**
 * @license
 * Copyright 2025 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import type { WidgetProps } from './WidgetRenderer';

interface TimelineEvent {
  timestamp: string;
  label: string;
  type?: string;
  severity?: string;
  device?: string;
}

interface TimelineData {
  events: TimelineEvent[];
  label?: string;
}

const EVENT_COLORS: Record<string, string> = {
  device_seen: '#3b82f6',
  zone_change: '#8b5cf6',
  alert: '#ef4444',
  tag_change: '#10b981',
  custom: '#6b7280',
};

export function Timeline({ data, sendMessage }: WidgetProps) {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- widget data from LLM
  const d = data as unknown as TimelineData;

  return (
    <div className="pcw-widget-card pcw-timeline">
      {d.label && <div className="pcw-timeline__label">{d.label}</div>}
      <div className="pcw-timeline__events">
        {d.events.map((event, i) => {
          const color = EVENT_COLORS[event.type ?? 'custom'] ?? EVENT_COLORS['custom'];
          return (
            <div key={`${event.timestamp}-${String(i)}`} className="pcw-timeline__event">
              <div className="pcw-timeline__marker" style={{ backgroundColor: color }} />
              <div className="pcw-timeline__content">
                <span className="pcw-timeline__time">
                  {new Date(event.timestamp).toLocaleTimeString(undefined, {
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </span>
                <span className="pcw-timeline__event-label">{event.label}</span>
                {event.device && (
                  <button
                    type="button"
                    className="pcw-alert-card__device-link"
                    onClick={() => sendMessage(`Tell me about device ${event.device}`)}
                  >
                    {event.device}
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
