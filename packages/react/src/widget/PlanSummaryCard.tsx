/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import type { PlanSummaryBlock } from '../types';

interface PlanSummaryCardProps {
  block: PlanSummaryBlock;
}

/**
 * Read-only summary of the SetupPlan that `load_template_plan`
 * composed from the installed template. Surfaces required + optional
 * connections and config questions so the user can verify the right
 * template loaded inline. No interaction affordances.
 */
export function PlanSummaryCard({ block }: PlanSummaryCardProps) {
  return (
    <div className="pcw-plan-summary">
      <div className="pcw-plan-summary__title">{block.templateTitle}</div>

      {block.requiredSlots.length > 0 && (
        <SlotSection title="Required connections" slots={block.requiredSlots} required />
      )}
      {block.optionalSlots.length > 0 && (
        <SlotSection title="Optional connections" slots={block.optionalSlots} required={false} />
      )}
      {block.configQuestions.length > 0 && (
        <div className="pcw-plan-summary__section">
          <div className="pcw-plan-summary__heading">Configuration</div>
          <ul className="pcw-plan-summary__list">
            {block.configQuestions.map((q) => (
              <li key={q.key} className="pcw-plan-summary__item">
                <span className="pcw-plan-summary__item-label">{q.question}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function SlotSection({
  title,
  slots,
  required,
}: {
  title: string;
  slots: PlanSummaryBlock['requiredSlots'];
  required: boolean;
}) {
  return (
    <div className="pcw-plan-summary__section">
      <div className="pcw-plan-summary__heading">
        {title}
        {required && <span className="pcw-plan-summary__badge">required</span>}
      </div>
      <ul className="pcw-plan-summary__list">
        {slots.map((slot) => {
          const optionLabels = slot.options.map((o) => o.displayName).join(' / ');
          return (
            <li key={slot.label} className="pcw-plan-summary__item">
              <span className="pcw-plan-summary__item-label">
                {slot.label}
                {optionLabels && optionLabels !== slot.label && (
                  <span className="pcw-plan-summary__item-options"> · {optionLabels}</span>
                )}
              </span>
              {slot.description && (
                <span className="pcw-plan-summary__item-desc">{slot.description}</span>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
