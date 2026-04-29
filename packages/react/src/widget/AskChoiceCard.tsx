/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import { useState } from 'react';
import type { AskChoiceBlock } from '../types';

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
 */
export function AskChoiceCard({ block, onSubmit }: AskChoiceCardProps) {
  const [selected, setSelected] = useState<string[]>([]);
  const submitted = block.status === 'submitted';

  if (submitted) {
    const summary = (block.answer ?? []).join(', ');
    return (
      <div className="pcw-ask-choice pcw-ask-choice--submitted">
        <div className="pcw-ask-choice__question">{block.question}</div>
        <div className="pcw-ask-choice__summary">{summary}</div>
      </div>
    );
  }

  const handleClick = (value: string): void => {
    if (block.multi) {
      setSelected((prev) =>
        prev.includes(value) ? prev.filter((v) => v !== value) : [...prev, value],
      );
      return;
    }
    onSubmit(block.askId, [value], formatMessage([value]));
  };

  const handleSubmit = (): void => {
    if (selected.length === 0) return;
    onSubmit(block.askId, selected, formatMessage(selected));
  };

  return (
    <div className="pcw-ask-choice">
      <div className="pcw-ask-choice__question">{block.question}</div>
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
      {block.multi && (
        <button
          type="button"
          className="pcw-ask-choice__submit"
          onClick={handleSubmit}
          disabled={selected.length === 0}
        >
          Continue
        </button>
      )}
    </div>
  );
}

function formatMessage(values: string[]): string {
  return values.join(', ');
}
