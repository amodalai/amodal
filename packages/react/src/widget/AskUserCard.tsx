/**
 * @license
 * Copyright 2025 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import { useState } from 'react';
import type { AskUserQuestion, AskUserBlock } from '../types';

interface AskUserCardProps {
  block: AskUserBlock;
  onSubmit: (askId: string, answers: Record<string, string>) => void;
}

function QuestionField({
  question,
  index,
  value,
  onChange,
  disabled,
}: {
  question: AskUserQuestion;
  index: number;
  value: string;
  onChange: (value: string) => void;
  disabled: boolean;
}) {
  const fieldId = `ask-user-q-${String(index)}`;

  switch (question.type) {
    case 'text':
      return (
        <div className="pcw-ask-user__field">
          <label htmlFor={fieldId} className="pcw-ask-user__label">
            {question.header && <span className="pcw-ask-user__header">{question.header}</span>}
            {question.question}
          </label>
          <textarea
            id={fieldId}
            className="pcw-ask-user__textarea"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder={question.placeholder ?? ''}
            disabled={disabled}
            rows={3}
          />
        </div>
      );

    case 'yesno':
      return (
        <div className="pcw-ask-user__field">
          <span className="pcw-ask-user__label">
            {question.header && <span className="pcw-ask-user__header">{question.header}</span>}
            {question.question}
          </span>
          <div className="pcw-ask-user__yesno">
            <button
              type="button"
              className={`pcw-ask-user__yesno-btn ${value === 'yes' ? 'pcw-ask-user__yesno-btn--active' : ''}`}
              onClick={() => onChange('yes')}
              disabled={disabled}
            >
              Yes
            </button>
            <button
              type="button"
              className={`pcw-ask-user__yesno-btn ${value === 'no' ? 'pcw-ask-user__yesno-btn--active' : ''}`}
              onClick={() => onChange('no')}
              disabled={disabled}
            >
              No
            </button>
          </div>
        </div>
      );

    case 'choice': {
      const options = question.options ?? [];
      if (question.multiSelect) {
        const selected = value ? value.split(',').filter(Boolean) : [];
        const toggle = (label: string) => {
          const next = selected.includes(label)
            ? selected.filter((s) => s !== label)
            : [...selected, label];
          onChange(next.join(','));
        };
        return (
          <div className="pcw-ask-user__field">
            <span className="pcw-ask-user__label">
              {question.header && <span className="pcw-ask-user__header">{question.header}</span>}
              {question.question}
            </span>
            <div className="pcw-ask-user__choices">
              {options.map((opt) => (
                <label key={opt.label} className="pcw-ask-user__choice">
                  <input
                    type="checkbox"
                    checked={selected.includes(opt.label)}
                    onChange={() => toggle(opt.label)}
                    disabled={disabled}
                  />
                  <span className="pcw-ask-user__choice-label">{opt.label}</span>
                  {opt.description && (
                    <span className="pcw-ask-user__choice-desc">{opt.description}</span>
                  )}
                </label>
              ))}
            </div>
          </div>
        );
      }

      return (
        <div className="pcw-ask-user__field">
          <span className="pcw-ask-user__label">
            {question.header && <span className="pcw-ask-user__header">{question.header}</span>}
            {question.question}
          </span>
          <div className="pcw-ask-user__choices">
            {options.map((opt) => (
              <label key={opt.label} className="pcw-ask-user__choice">
                <input
                  type="radio"
                  name={fieldId}
                  checked={value === opt.label}
                  onChange={() => onChange(opt.label)}
                  disabled={disabled}
                />
                <span className="pcw-ask-user__choice-label">{opt.label}</span>
                {opt.description && (
                  <span className="pcw-ask-user__choice-desc">{opt.description}</span>
                )}
              </label>
            ))}
          </div>
        </div>
      );
    }

    default:
      return null;
  }
}

export function AskUserCard({ block, onSubmit }: AskUserCardProps) {
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const isSubmitted = block.status === 'submitted';
  const disabled = isSubmitted || submitting;

  const handleSubmit = () => {
    setSubmitting(true);
    onSubmit(block.askId, answers);
  };

  // Show read-only summary after submission
  if (isSubmitted && block.answers) {
    return (
      <div className="pcw-ask-user pcw-ask-user--submitted">
        {block.questions.map((q, i) => (
          <div key={`${q.header}-${String(i)}`} className="pcw-ask-user__summary">
            <span className="pcw-ask-user__summary-q">{q.question}</span>
            <span className="pcw-ask-user__summary-a">{block.answers?.[String(i)] ?? ''}</span>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="pcw-ask-user">
      {block.questions.map((q, i) => (
        <QuestionField
          key={`${q.header}-${String(i)}`}
          question={q}
          index={i}
          value={answers[String(i)] ?? ''}
          onChange={(v) => setAnswers((prev) => ({ ...prev, [String(i)]: v }))}
          disabled={disabled}
        />
      ))}
      <button
        type="button"
        className="pcw-ask-user__submit"
        onClick={handleSubmit}
        disabled={disabled}
      >
        {submitting ? 'Submitting...' : 'Submit'}
      </button>
    </div>
  );
}
