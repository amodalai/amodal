/**
 * @license
 * Copyright 2025 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { AskUserCard } from '../widget/AskUserCard';
import type { AskUserBlock } from '../types';

function makeBlock(overrides: Partial<AskUserBlock> = {}): AskUserBlock {
  return {
    type: 'ask_user',
    askId: 'ask-1',
    questions: [
      {
        question: 'Which zone should I investigate?',
        header: 'Zone',
        type: 'choice',
        options: [
          { label: 'Zone A', description: 'Main building' },
          { label: 'Zone B', description: 'Annex' },
        ],
      },
    ],
    status: 'pending',
    ...overrides,
  };
}

describe('AskUserCard', () => {
  it('renders choice question with radio buttons', () => {
    const block = makeBlock();
    render(<AskUserCard block={block} onSubmit={vi.fn()} />);
    expect(screen.getByText('Which zone should I investigate?')).toBeDefined();
    expect(screen.getByText('Zone A')).toBeDefined();
    expect(screen.getByText('Zone B')).toBeDefined();
    expect(screen.getByText('Submit')).toBeDefined();
  });

  it('renders text question with textarea', () => {
    const block = makeBlock({
      questions: [
        {
          question: 'Describe the issue',
          header: 'Issue',
          type: 'text',
          placeholder: 'Enter details...',
        },
      ],
    });
    render(<AskUserCard block={block} onSubmit={vi.fn()} />);
    expect(screen.getByText('Describe the issue')).toBeDefined();
    const textarea = screen.getByPlaceholderText('Enter details...');
    expect(textarea).toBeDefined();
  });

  it('renders yesno question with two buttons', () => {
    const block = makeBlock({
      questions: [
        {
          question: 'Should I proceed?',
          header: 'Confirm',
          type: 'yesno',
        },
      ],
    });
    render(<AskUserCard block={block} onSubmit={vi.fn()} />);
    expect(screen.getByText('Yes')).toBeDefined();
    expect(screen.getByText('No')).toBeDefined();
  });

  it('calls onSubmit with answers when Submit is clicked', () => {
    const onSubmit = vi.fn();
    const block = makeBlock({
      questions: [
        {
          question: 'Should I proceed?',
          header: 'Confirm',
          type: 'yesno',
        },
      ],
    });
    render(<AskUserCard block={block} onSubmit={onSubmit} />);

    fireEvent.click(screen.getByText('Yes'));
    fireEvent.click(screen.getByText('Submit'));

    expect(onSubmit).toHaveBeenCalledWith('ask-1', { '0': 'yes' });
  });

  it('shows read-only summary when submitted', () => {
    const block = makeBlock({
      status: 'submitted',
      answers: { '0': 'Zone A' },
    });
    render(<AskUserCard block={block} onSubmit={vi.fn()} />);
    expect(screen.getByText('Zone A')).toBeDefined();
    // Submit button should not be present
    expect(screen.queryByText('Submit')).toBeNull();
  });

  it('disables inputs after clicking Submit', () => {
    const block = makeBlock({
      questions: [
        {
          question: 'Describe the issue',
          header: 'Issue',
          type: 'text',
        },
      ],
    });
    const onSubmit = vi.fn();
    render(<AskUserCard block={block} onSubmit={onSubmit} />);

    fireEvent.click(screen.getByText('Submit'));

    // Button should show submitting state
    expect(screen.getByText('Submitting...')).toBeDefined();
  });

  it('renders multi-select choice with checkboxes', () => {
    const block = makeBlock({
      questions: [
        {
          question: 'Select zones',
          header: 'Zones',
          type: 'choice',
          multiSelect: true,
          options: [
            { label: 'Zone A', description: 'Main' },
            { label: 'Zone B', description: 'Annex' },
          ],
        },
      ],
    });
    render(<AskUserCard block={block} onSubmit={vi.fn()} />);
    const checkboxes = screen.getAllByRole('checkbox');
    expect(checkboxes).toHaveLength(2);
  });
});
