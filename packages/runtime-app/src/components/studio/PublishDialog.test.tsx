/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { PublishDialog } from './PublishDialog';
import type { DraftFile } from '../../hooks/useDraftWorkspace';

const sampleDrafts: DraftFile[] = [
  { filePath: 'skills/pricing.md', content: '# Pricing', updatedAt: '2026-01-01T00:00:00Z' },
  { filePath: 'knowledge/faq.md', content: '# FAQ', updatedAt: '2026-01-02T00:00:00Z' },
];

describe('PublishDialog', () => {
  it('renders the draft file list', () => {
    render(
      <PublishDialog drafts={sampleDrafts} onConfirm={vi.fn()} onCancel={vi.fn()} />,
    );
    expect(screen.getByText('skills/pricing.md')).toBeDefined();
    expect(screen.getByText('knowledge/faq.md')).toBeDefined();
  });

  it('disables the Commit button when commit message is empty', () => {
    render(
      <PublishDialog drafts={sampleDrafts} onConfirm={vi.fn()} onCancel={vi.fn()} />,
    );
    const button = screen.getByRole('button', { name: 'Commit' });
    expect((button as HTMLButtonElement).disabled).toBe(true);
  });

  it('disables the Commit button when commit message is only whitespace', () => {
    render(
      <PublishDialog drafts={sampleDrafts} onConfirm={vi.fn()} onCancel={vi.fn()} />,
    );
    const textarea = screen.getByPlaceholderText('Update pricing skill');
    fireEvent.change(textarea, { target: { value: '   \n\t  ' } });
    const button = screen.getByRole('button', { name: 'Commit' });
    expect((button as HTMLButtonElement).disabled).toBe(true);
  });

  it('enables and calls onConfirm with the trimmed commit message', async () => {
    const onConfirm = vi.fn(async () => ({ commitSha: 'deadbeef' }));
    render(
      <PublishDialog drafts={sampleDrafts} onConfirm={onConfirm} onCancel={vi.fn()} />,
    );
    const textarea = screen.getByPlaceholderText('Update pricing skill');
    fireEvent.change(textarea, { target: { value: '  Update pricing  ' } });
    const button = screen.getByRole('button', { name: 'Commit' });
    expect((button as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(button);
    await waitFor(() => {
      expect(onConfirm).toHaveBeenCalledWith('Update pricing');
    });
  });

  it('shows an inline error on failure and keeps the dialog mounted', async () => {
    const onConfirm = vi.fn(async () => {
      throw new Error('branch is protected');
    });
    render(
      <PublishDialog drafts={sampleDrafts} onConfirm={onConfirm} onCancel={vi.fn()} />,
    );
    fireEvent.change(screen.getByPlaceholderText('Update pricing skill'), {
      target: { value: 'x' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Commit' }));
    await waitFor(() => {
      expect(screen.getByText('branch is protected')).toBeDefined();
    });
    expect(screen.getByRole('dialog')).toBeDefined();
  });

  it('calls onCancel when Cancel is clicked', () => {
    const onCancel = vi.fn();
    render(
      <PublishDialog drafts={sampleDrafts} onConfirm={vi.fn()} onCancel={onCancel} />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});
