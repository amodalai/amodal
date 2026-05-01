/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import { useState } from 'react';
import type { AskChoiceBlock, AskChoiceOption } from '../types';

interface AskChoiceCardProps {
  block: AskChoiceBlock;
  /** Called once with the chosen value(s). Single-select sends a single string;
   *  multi-select sends a comma-separated string. The chat reducer marks the
   *  block as submitted on the same dispatch. */
  onSubmit: (askId: string, values: string[], message: string) => void;
}

/**
 * Inline button row for the admin agent's `ask_choice` tool. Single-click
 * sends the value as the next user turn — no server round-trip — so the
 * agent receives it like any other user reply.
 *
 * When the block is `multi: true` AND any option has a `description`,
 * the card renders as a checkbox list with secondary text under each
 * label (used for the optional-connection batch question — F.6).
 * Otherwise it renders as the compact button row.
 */
export function AskChoiceCard({ block, onSubmit }: AskChoiceCardProps) {
  const [selected, setSelected] = useState<string[]>([]);
  const submitted = block.status === 'submitted';

  if (submitted) {
    const summary = (block.answer ?? [])
      .map((v) => block.options.find((o) => o.value === v)?.label ?? v)
      .join(', ');
    return (
      <div className="pcw-ask-choice pcw-ask-choice--submitted">
        <div className="pcw-ask-choice__question">{block.question}</div>
        <div className="pcw-ask-choice__summary">{summary || 'None of these'}</div>
      </div>
    );
  }

  const hasDescriptions = block.options.some((o) => Boolean(o.description));
  const useCheckboxList = block.multi && hasDescriptions;

  const toggle = (value: string): void => {
    setSelected((prev) =>
      prev.includes(value) ? prev.filter((v) => v !== value) : [...prev, value],
    );
  };

  const handleClick = (value: string): void => {
    if (block.multi) {
      toggle(value);
      return;
    }
    onSubmit(block.askId, [value], formatMessage([value], block.options));
  };

  const handleSubmit = (): void => {
    onSubmit(block.askId, selected, formatMessage(selected, block.options));
  };

  return (
    <div className="pcw-ask-choice">
      <div className="pcw-ask-choice__question">{block.question}</div>

      {useCheckboxList ? (
        <ul className="pcw-ask-choice__checklist" role="group">
          {block.options.map((opt) => {
            const isSelected = selected.includes(opt.value);
            return (
              <li key={opt.value} className="pcw-ask-choice__check-row">
                <label className="pcw-ask-choice__check-label">
                  <input
                    type="checkbox"
                    className="pcw-ask-choice__check-input"
                    checked={isSelected}
                    onChange={() => toggle(opt.value)}
                  />
                  <span className="pcw-ask-choice__check-text">
                    <span className="pcw-ask-choice__check-name">{opt.label}</span>
                    {opt.description && (
                      <span className="pcw-ask-choice__check-desc">{opt.description}</span>
                    )}
                  </span>
                </label>
              </li>
            );
          })}
        </ul>
      ) : (
        <div className="pcw-ask-choice__options">
          {block.options.map((opt) => {
            const isSelected = selected.includes(opt.value);
            return (
              <button
                key={opt.value}
                type="button"
                className={`pcw-ask-choice__btn${isSelected ? ' pcw-ask-choice__btn--active' : ''}`}
                onClick={() => handleClick(opt.value)}
              >
                {opt.label}
              </button>
            );
          })}
        </div>
      )}

      {block.multi && (
        <button
          type="button"
          className="pcw-ask-choice__submit"
          onClick={handleSubmit}
          disabled={!useCheckboxList && selected.length === 0}
        >
          {useCheckboxList && selected.length === 0 ? 'Skip all' : 'Continue'}
        </button>
      )}
    </div>
  );
}

/**
 * Convert the picked option values into a human-readable user-message
 * string. The chat reducer pushes this into the message list as if the
 * user typed it, so it should read like the option's visible label
 * (e.g. "HubSpot"), not its internal id (e.g.
 * "@this-npm-test-org/connection-hubspot"). The structured `values`
 * array still carries the raw values back to the agent — this is the
 * display half only.
 */
function formatMessage(values: string[], options: readonly AskChoiceOption[]): string {
  if (values.length === 0) return 'None of these';
  return values
    .map((v) => options.find((o) => o.value === v)?.label ?? v)
    .join(', ');
}
