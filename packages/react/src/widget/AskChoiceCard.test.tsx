/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { AskChoiceCard } from './AskChoiceCard';
import type { AskChoiceBlock } from '../types';

function makeBlock(overrides: Partial<AskChoiceBlock> = {}): AskChoiceBlock {
  return {
    type: 'ask_choice',
    askId: 'ask-1',
    question: 'Pick one',
    options: [
      { label: 'Yes', value: 'yes' },
      { label: 'No', value: 'no' },
    ],
    multi: false,
    status: 'pending',
    ...overrides,
  };
}

describe('AskChoiceCard — single-select button row', () => {
  it('submits immediately on click — posted message is the option value verbatim', async () => {
    const onSubmit = vi.fn();
    render(<AskChoiceCard block={makeBlock()} onSubmit={onSubmit} />);
    await userEvent.click(screen.getByRole('button', { name: 'Yes' }));
    // Posted message is the value verbatim so intent matchers can
    // catch it. The visible label on the button stays "Yes"; the
    // value ("yes" here) is what the user effectively says.
    expect(onSubmit).toHaveBeenCalledWith('ask-1', ['yes'], 'yes');
  });
});

describe('AskChoiceCard — multi-select button row (no descriptions)', () => {
  it('renders Continue and disables when none selected', () => {
    render(<AskChoiceCard block={makeBlock({ multi: true })} onSubmit={vi.fn()} />);
    const submit = screen.getByRole('button', { name: 'Continue' });
    expect(submit).toBeDisabled();
  });
});

describe('AskChoiceCard — checkbox list (multi + descriptions)', () => {
  const block = makeBlock({
    question: 'Any of these would help. Pick what you want.',
    multi: true,
    options: [
      { label: 'GA4', value: 'ga4', description: 'Pull weekly traffic counts.' },
      { label: 'HubSpot', value: 'hubspot', description: 'Add CRM context.' },
      { label: 'Mailchimp', value: 'mailchimp', description: 'Include open rates.' },
    ],
  });

  it('renders a checkbox per option with description text', () => {
    render(<AskChoiceCard block={block} onSubmit={vi.fn()} />);
    expect(screen.getAllByRole('checkbox')).toHaveLength(3);
    expect(screen.getByText('Pull weekly traffic counts.')).toBeInTheDocument();
    expect(screen.getByText('Add CRM context.')).toBeInTheDocument();
    expect(screen.getByText('Include open rates.')).toBeInTheDocument();
  });

  it('submit reads "Skip all" when nothing is checked', () => {
    render(<AskChoiceCard block={block} onSubmit={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Skip all' })).not.toBeDisabled();
  });

  it('clicking Skip all submits an empty selection with a "None of these" message', async () => {
    const onSubmit = vi.fn();
    render(<AskChoiceCard block={block} onSubmit={onSubmit} />);
    await userEvent.click(screen.getByRole('button', { name: 'Skip all' }));
    expect(onSubmit).toHaveBeenCalledWith('ask-1', [], 'None of these');
  });

  it('toggling checkboxes and submitting sends the selected values', async () => {
    const onSubmit = vi.fn();
    render(<AskChoiceCard block={block} onSubmit={onSubmit} />);
    const checks = screen.getAllByRole('checkbox');
    await userEvent.click(checks[0]);
    await userEvent.click(checks[2]);
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }));
    // Posted message is the joined values verbatim — intent matchers
    // operate on the literal phrase, not on the visible labels.
    expect(onSubmit).toHaveBeenCalledWith('ask-1', ['ga4', 'mailchimp'], 'ga4, mailchimp');
  });
});

describe('AskChoiceCard — submitted state', () => {
  it('renders the answer summary using labels, not raw values', () => {
    render(
      <AskChoiceCard
        block={makeBlock({ status: 'submitted', answer: ['yes'] })}
        onSubmit={vi.fn()}
      />,
    );
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(screen.getByText('Yes')).toBeInTheDocument();
  });
});
