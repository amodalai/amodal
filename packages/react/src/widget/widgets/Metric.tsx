/**
 * @license
 * Copyright 2025 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import type { WidgetProps } from './WidgetRenderer';

interface MetricData {
  label: string;
  value: number | string;
  unit?: string;
  trend?: 'up' | 'down' | 'flat';
  description?: string;
  previous_value?: number | string;
}

const TREND_ARROWS: Record<string, string> = {
  up: '\u2191',
  down: '\u2193',
  flat: '\u2192',
};

export function Metric({ data }: WidgetProps) {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- widget data from LLM
  const d = data as unknown as Partial<MetricData>;
  const label = d.label ?? 'Metric';
  const value = d.value ?? '—';

  return (
    <div className="pcw-widget-card pcw-metric" data-testid="metric">
      <div className="pcw-metric__label">{label}</div>
      <div className="pcw-metric__value-row">
        <span className="pcw-metric__value">{String(value)}</span>
        {d.unit && <span className="pcw-metric__unit">{d.unit}</span>}
        {d.trend && (
          <span className={`pcw-metric__trend pcw-metric__trend--${d.trend}`}>
            {TREND_ARROWS[d.trend] ?? ''}
          </span>
        )}
      </div>
      {d.description && (
        <div className="pcw-metric__description">{d.description}</div>
      )}
      {d.previous_value != null && (
        <div className="pcw-metric__previous">
          Previous: {String(d.previous_value)}{d.unit ? ` ${d.unit}` : ''}
        </div>
      )}
    </div>
  );
}
