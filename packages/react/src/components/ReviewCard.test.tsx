/**
 * @license
 * Copyright 2025 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ReviewCard } from './ReviewCard';
import type { ConfirmationInfo } from '../types';

const baseConfirmation: ConfirmationInfo = {
  endpoint: '/api/tickets',
  method: 'POST',
  reason: 'Creates a new ticket for tracking',
  escalated: true,
  params: { title: 'Bug fix', priority: 'high' },
  connectionName: 'jira',
  correlationId: 'c1',
  status: 'pending',
};

describe('ReviewCard', () => {
  it('renders method, endpoint, and reason', () => {
    render(<ReviewCard confirmation={baseConfirmation} onApprove={vi.fn()} onDeny={vi.fn()} />);
    expect(screen.getByText('POST')).toBeInTheDocument();
    expect(screen.getByText('/api/tickets')).toBeInTheDocument();
    expect(screen.getByText('Creates a new ticket for tracking')).toBeInTheDocument();
  });

  it('shows escalation badge when escalated', () => {
    render(<ReviewCard confirmation={baseConfirmation} onApprove={vi.fn()} onDeny={vi.fn()} />);
    expect(screen.getByTestId('escalation-badge')).toHaveTextContent('Escalated');
  });

  it('hides escalation badge when not escalated', () => {
    render(
      <ReviewCard
        confirmation={{ ...baseConfirmation, escalated: false }}
        onApprove={vi.fn()}
        onDeny={vi.fn()}
      />,
    );
    expect(screen.queryByTestId('escalation-badge')).not.toBeInTheDocument();
  });

  it('shows connection name', () => {
    render(<ReviewCard confirmation={baseConfirmation} onApprove={vi.fn()} onDeny={vi.fn()} />);
    expect(screen.getByText('Connection: jira')).toBeInTheDocument();
  });

  it('shows params as JSON', () => {
    render(<ReviewCard confirmation={baseConfirmation} onApprove={vi.fn()} onDeny={vi.fn()} />);
    const paramsEl = screen.getByTestId('review-params');
    expect(paramsEl).toHaveTextContent('title');
    expect(paramsEl).toHaveTextContent('Bug fix');
  });

  it('calls onApprove when approve clicked', async () => {
    const user = userEvent.setup();
    const onApprove = vi.fn();
    render(<ReviewCard confirmation={baseConfirmation} onApprove={onApprove} onDeny={vi.fn()} />);

    await user.click(screen.getByTestId('review-approve'));
    expect(onApprove).toHaveBeenCalledOnce();
  });

  it('shows denied status', () => {
    render(
      <ReviewCard
        confirmation={{ ...baseConfirmation, status: 'denied' }}
        onApprove={vi.fn()}
        onDeny={vi.fn()}
      />,
    );
    expect(screen.getByTestId('review-status')).toHaveTextContent('Denied');
    expect(screen.queryByTestId('review-approve')).not.toBeInTheDocument();
  });
});
