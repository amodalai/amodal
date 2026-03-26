/**
 * @license
 * Copyright 2025 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import type { WidgetProps } from './WidgetRenderer';

interface ScoreBreakdownData {
  label?: string;
  total_score: number;
  max_score?: number;
  factors: Array<{
    name: string;
    value: number;
    max?: number;
    description?: string;
  }>;
}

export function ScoreBreakdown({ data }: WidgetProps) {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- widget data from LLM
  const d = data as unknown as ScoreBreakdownData;
  const maxScore = d.max_score ?? 100;
  const scorePercent = Math.min(100, Math.max(0, (d.total_score / maxScore) * 100));

  return (
    <div className="pcw-widget-card pcw-score-breakdown">
      {d.label && <div className="pcw-score-breakdown__label">{d.label}</div>}
      <div className="pcw-score-bar">
        <div className="pcw-score-bar__label">
          Score: {d.total_score}{maxScore !== 100 ? ` / ${maxScore}` : ''}
        </div>
        <div className="pcw-score-bar__track">
          <div
            className="pcw-score-bar__fill"
            style={{ width: `${String(scorePercent)}%` }}
          />
        </div>
      </div>
      <div className="pcw-score-breakdown__factors">
        {d.factors.map((factor) => {
          const factorMax = factor.max ?? maxScore;
          const factorPercent = Math.min(100, Math.max(0, (factor.value / factorMax) * 100));
          return (
            <div key={factor.name} className="pcw-score-breakdown__factor">
              <div className="pcw-score-breakdown__factor-header">
                <span className="pcw-score-breakdown__factor-name">
                  {factor.name.replace(/_/g, ' ')}
                </span>
                <span className="pcw-score-breakdown__factor-value">+{factor.value}</span>
              </div>
              <div className="pcw-score-breakdown__factor-bar">
                <div
                  className="pcw-score-breakdown__factor-fill"
                  style={{ width: `${String(factorPercent)}%` }}
                />
              </div>
              {factor.description && (
                <div className="pcw-score-breakdown__factor-desc">{factor.description}</div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
