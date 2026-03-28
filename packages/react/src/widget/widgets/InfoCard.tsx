/**
 * @license
 * Copyright 2025 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import type { WidgetProps } from './WidgetRenderer';

interface InfoCardData {
  title: string;
  subtitle?: string;
  description?: string;
  fields: Array<{ label: string; value: string | number | boolean }>;
  tags?: string[];
  status?: 'ok' | 'warning' | 'critical' | 'info';
  actions?: Array<{ label: string; message: string }>;
}

export function InfoCard({ data, sendMessage }: WidgetProps) {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- widget data from LLM
  const d = data as unknown as Partial<InfoCardData>;
  const title = d.title ?? 'Untitled';
  const fields = Array.isArray(d.fields) ? d.fields : [];
  const tags = Array.isArray(d.tags) ? d.tags : [];
  const actions = Array.isArray(d.actions) ? d.actions : [];

  return (
    <div className="pcw-widget-card pcw-info-card" data-testid="info-card">
      <div className="pcw-info-card__header">
        <span className="pcw-info-card__title">{title}</span>
        {d.status && (
          <span className={`pcw-info-card__status pcw-info-card__status--${d.status}`}>
            {d.status}
          </span>
        )}
      </div>
      {d.subtitle && (
        <div className="pcw-info-card__subtitle">{d.subtitle}</div>
      )}
      {d.description && (
        <p className="pcw-info-card__description">{d.description}</p>
      )}
      {fields.length > 0 && (
        <div className="pcw-info-card__fields">
          {fields.map((f) => (
            <div key={f.label} className="pcw-info-card__field">
              <span className="pcw-info-card__field-label">{f.label}</span>
              <span className="pcw-info-card__field-value">{String(f.value)}</span>
            </div>
          ))}
        </div>
      )}
      {tags.length > 0 && (
        <div className="pcw-info-card__tags">
          {tags.map((t) => (
            <span key={t} className="pcw-info-card__tag">{t}</span>
          ))}
        </div>
      )}
      {actions.length > 0 && (
        <div className="pcw-info-card__actions">
          {actions.map((a) => (
            <button
              key={a.label}
              type="button"
              className="pcw-info-card__btn"
              onClick={() => sendMessage(a.message)}
            >
              {a.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
