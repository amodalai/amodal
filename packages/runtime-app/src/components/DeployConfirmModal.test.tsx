/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

/**
 * Tests for the DeployConfirmModal — interaction behavior, keyboard
 * accessibility, and busy-state UI.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { DeployConfirmModal } from './DeployConfirmModal';

function renderModal(props: Partial<React.ComponentProps<typeof DeployConfirmModal>> = {}) {
  const onConfirm = vi.fn();
  const onCancel = vi.fn();
  const utils = render(
    <DeployConfirmModal
      files={['skills/pricing.md', 'knowledge/returns.md']}
      onConfirm={onConfirm}
      onCancel={onCancel}
      {...props}
    />,
  );
  return { ...utils, onConfirm, onCancel };
}

describe('DeployConfirmModal', () => {
  it('renders the file list', () => {
    renderModal();
    expect(screen.getByText('skills/pricing.md')).toBeDefined();
    expect(screen.getByText('knowledge/returns.md')).toBeDefined();
  });

  it('shows the file count in the header', () => {
    renderModal();
    expect(screen.getByText(/2 files will be deployed/)).toBeDefined();
  });

  it('uses singular when there is exactly one file', () => {
    renderModal({ files: ['skills/pricing.md'] });
    expect(screen.getByText(/1 file will be deployed/)).toBeDefined();
  });

  it('shows "No changes" when files array is empty', () => {
    renderModal({ files: [] });
    expect(screen.getByText('No changes')).toBeDefined();
  });

  it('Deploy button is disabled when there are no files', () => {
    renderModal({ files: [] });
    const button = screen.getByRole('button', { name: 'Deploy' });
    expect(button).toHaveProperty('disabled', true);
  });

  it('calls onConfirm when Deploy is clicked', () => {
    const { onConfirm } = renderModal();
    fireEvent.click(screen.getByRole('button', { name: 'Deploy' }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('calls onCancel when Cancel is clicked', () => {
    const { onCancel } = renderModal();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('calls onCancel when the backdrop is clicked', () => {
    const { onCancel } = renderModal();
    const dialog = screen.getByRole('dialog');
    // The backdrop is the parent of the dialog content. Click the backdrop
    // (the dialog element itself, not its inner content).
    fireEvent.click(dialog);
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('does NOT call onCancel when the dialog content is clicked', () => {
    const { onCancel } = renderModal();
    // Clicking inside the modal content should not close the modal —
    // stopPropagation prevents the backdrop click handler from firing.
    fireEvent.click(screen.getByText('skills/pricing.md'));
    expect(onCancel).not.toHaveBeenCalled();
  });

  it('calls onCancel when Escape is pressed', () => {
    const { onCancel } = renderModal();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('does not call onCancel for other keys', () => {
    const { onCancel } = renderModal();
    fireEvent.keyDown(window, { key: 'Enter' });
    fireEvent.keyDown(window, { key: 'a' });
    expect(onCancel).not.toHaveBeenCalled();
  });

  it('shows "Deploying..." and disables both buttons when busy', () => {
    renderModal({ busy: true });
    expect(screen.getByText('Deploying...')).toBeDefined();
    const deployBtn = screen.getByRole('button', { name: 'Deploying...' });
    const cancelBtn = screen.getByRole('button', { name: 'Cancel' });
    expect(deployBtn).toHaveProperty('disabled', true);
    expect(cancelBtn).toHaveProperty('disabled', true);
  });

  it('does not call onCancel from Escape when busy', () => {
    const { onCancel } = renderModal({ busy: true });
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onCancel).not.toHaveBeenCalled();
  });

  it('does not call onCancel from backdrop when busy', () => {
    const { onCancel } = renderModal({ busy: true });
    fireEvent.click(screen.getByRole('dialog'));
    expect(onCancel).not.toHaveBeenCalled();
  });

  it('removes the keydown listener on unmount', () => {
    const { onCancel, unmount } = renderModal();
    unmount();
    // Pressing Escape after unmount must not call onCancel. If the listener
    // wasn't cleaned up, this would call the now-stale handler.
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onCancel).not.toHaveBeenCalled();
  });
});
