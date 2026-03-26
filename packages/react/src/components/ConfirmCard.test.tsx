/**
 * @license
 * Copyright 2025 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ConfirmCard } from './ConfirmCard';
import type { ConfirmationInfo } from '../types';

const baseConfirmation: ConfirmationInfo = {
  endpoint: '/api/tickets',
  method: 'POST',
  reason: 'Creates a new Jira ticket',
  escalated: false,
  correlationId: 'c1',
  status: 'pending',
};

describe('ConfirmCard', () => {
  it('renders method, endpoint, and reason', () => {
    render(<ConfirmCard confirmation={baseConfirmation} onApprove={vi.fn()} onDeny={vi.fn()} />);
    expect(screen.getByText('POST')).toBeInTheDocument();
    expect(screen.getByText('/api/tickets')).toBeInTheDocument();
    expect(screen.getByText('Creates a new Jira ticket')).toBeInTheDocument();
  });

  it('shows approve and deny buttons when pending', () => {
    render(<ConfirmCard confirmation={baseConfirmation} onApprove={vi.fn()} onDeny={vi.fn()} />);
    expect(screen.getByTestId('confirm-approve')).toBeInTheDocument();
    expect(screen.getByTestId('confirm-deny')).toBeInTheDocument();
  });

  it('calls onApprove when approve clicked', async () => {
    const user = userEvent.setup();
    const onApprove = vi.fn();
    render(<ConfirmCard confirmation={baseConfirmation} onApprove={onApprove} onDeny={vi.fn()} />);

    await user.click(screen.getByTestId('confirm-approve'));
    expect(onApprove).toHaveBeenCalledOnce();
  });

  it('calls onDeny when deny clicked', async () => {
    const user = userEvent.setup();
    const onDeny = vi.fn();
    render(<ConfirmCard confirmation={baseConfirmation} onApprove={vi.fn()} onDeny={onDeny} />);

    await user.click(screen.getByTestId('confirm-deny'));
    expect(onDeny).toHaveBeenCalledOnce();
  });

  it('shows status text instead of buttons when not pending', () => {
    render(
      <ConfirmCard
        confirmation={{ ...baseConfirmation, status: 'approved' }}
        onApprove={vi.fn()}
        onDeny={vi.fn()}
      />,
    );
    expect(screen.getByTestId('confirm-status')).toHaveTextContent('Approved');
    expect(screen.queryByTestId('confirm-approve')).not.toBeInTheDocument();
  });
});
