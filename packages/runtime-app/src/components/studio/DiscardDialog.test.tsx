/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { DiscardDialog } from './DiscardDialog';

describe('DiscardDialog', () => {
  it('renders the warning text with the draft count', () => {
    render(
      <DiscardDialog count={3} onConfirm={vi.fn()} onCancel={vi.fn()} />,
    );
    expect(screen.getByText(/Discard all 3 unpublished changes/)).toBeDefined();
  });

  it('uses singular wording for count === 1', () => {
    render(
      <DiscardDialog count={1} onConfirm={vi.fn()} onCancel={vi.fn()} />,
    );
    expect(screen.getByText(/Discard all 1 unpublished change\?/)).toBeDefined();
  });

  it('calls onCancel when Cancel is clicked', () => {
    const onCancel = vi.fn();
    render(
      <DiscardDialog count={2} onConfirm={vi.fn()} onCancel={onCancel} />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('calls onConfirm when Discard is clicked', async () => {
    const onConfirm = vi.fn(async () => undefined);
    render(
      <DiscardDialog count={2} onConfirm={onConfirm} onCancel={vi.fn()} />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Discard' }));
    await waitFor(() => {
      expect(onConfirm).toHaveBeenCalledTimes(1);
    });
  });

  it('shows an inline error and keeps the dialog mounted on failure', async () => {
    const onConfirm = vi.fn(async () => {
      throw new Error('storage exploded');
    });
    render(
      <DiscardDialog count={1} onConfirm={onConfirm} onCancel={vi.fn()} />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Discard' }));
    await waitFor(() => {
      expect(screen.getByText('storage exploded')).toBeDefined();
    });
    expect(screen.getByRole('dialog')).toBeDefined();
  });

  it('disables the Discard button when count === 0', () => {
    render(
      <DiscardDialog count={0} onConfirm={vi.fn()} onCancel={vi.fn()} />,
    );
    const button = screen.getByRole('button', { name: 'Discard' });
    expect((button as HTMLButtonElement).disabled).toBe(true);
  });
});
