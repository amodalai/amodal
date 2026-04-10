/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

/**
 * Tests for the WorkspaceBar — focused on the new modal flow added in this
 * PR. The bar's display logic (commit count, persisted branch, stale warning)
 * is exercised indirectly through the modal-opening tests.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { WorkspaceBar } from './WorkspaceBar';
import type { WorkspaceState } from '../hooks/useWorkspace';

interface FakeWorkspaceOverrides {
  files?: string[];
  isStale?: boolean;
  lockedByOtherTab?: boolean;
  warning?: string | null;
  persistedBranch?: string | null;
  /** Override the persist function — defaults to a stub that resolves successfully. */
  persist?: WorkspaceState['persist'];
  discard?: WorkspaceState['discard'];
}

/**
 * Build a fake WorkspaceState. Defaults give a "1 unsaved change" state with
 * one file in one commit, no warnings, no stale, not locked.
 */
function makeWorkspace(overrides: FakeWorkspaceOverrides = {}): WorkspaceState {
  const files = overrides.files ?? ['skills/pricing.md'];
  const persist = overrides.persist ?? vi.fn(async () => ({
    branch: 'config/test-123',
    headCommit: 'abc',
    commitCount: 1,
  }));
  const discard = overrides.discard ?? vi.fn(async () => undefined);
  return {
    ready: true,
    isDirty: files.length > 0,
    stored: files.length > 0
      ? {
          baseCommitSha: 'base',
          baseBranchName: 'main',
          headSha: 'head',
          bundle: 'YmFzZTY0',
          commits: [
            {
              sha: 'commit-1',
              message: 'Edit',
              files,
              timestamp: '2026-01-01T00:00:00Z',
            },
          ],
          lastModified: '2026-01-01T00:00:00Z',
        }
      : null,
    persistedBranch: overrides.persistedBranch ?? null,
    lockedByOtherTab: overrides.lockedByOtherTab ?? false,
    isStale: overrides.isStale ?? false,
    warning: overrides.warning ?? null,
    onFileSaved: vi.fn(),
    restore: vi.fn(async () => undefined),
    persist,
    discard,
  };
}

describe('WorkspaceBar — modal flow', () => {
  it('renders the Deploy button with the unsaved-change count', () => {
    render(<WorkspaceBar workspace={makeWorkspace()} />);
    expect(screen.getByText(/1 unsaved change/)).toBeDefined();
    expect(screen.getByRole('button', { name: 'Deploy' })).toBeDefined();
  });

  it('does not show the modal initially', () => {
    render(<WorkspaceBar workspace={makeWorkspace()} />);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('opens the confirmation modal when Deploy is clicked', () => {
    render(<WorkspaceBar workspace={makeWorkspace({ files: ['skills/a.md', 'knowledge/b.md'] })} />);
    fireEvent.click(screen.getByRole('button', { name: 'Deploy' }));
    expect(screen.getByRole('dialog')).toBeDefined();
    expect(screen.getByText('skills/a.md')).toBeDefined();
    expect(screen.getByText('knowledge/b.md')).toBeDefined();
  });

  it('deduplicates files across multiple commits in the modal', () => {
    // Two commits both touching skills/a.md should appear once.
    const workspace: WorkspaceState = {
      ...makeWorkspace(),
      stored: {
        baseCommitSha: 'base',
        baseBranchName: 'main',
        headSha: 'head',
        bundle: 'YmFzZTY0',
        commits: [
          { sha: 'c1', message: 'Edit 1', files: ['skills/a.md'], timestamp: '2026-01-01' },
          { sha: 'c2', message: 'Edit 2', files: ['skills/a.md', 'knowledge/b.md'], timestamp: '2026-01-02' },
        ],
        lastModified: '2026-01-02',
      },
      isDirty: true,
    };
    render(<WorkspaceBar workspace={workspace} />);
    fireEvent.click(screen.getByRole('button', { name: 'Deploy' }));
    // skills/a.md should appear exactly once even though two commits touched it
    expect(screen.getAllByText('skills/a.md')).toHaveLength(1);
    expect(screen.getByText('knowledge/b.md')).toBeDefined();
  });

  it('does not call persist when Deploy is clicked (modal opens first)', () => {
    const persist = vi.fn();
    render(<WorkspaceBar workspace={makeWorkspace({ persist })} />);
    fireEvent.click(screen.getByRole('button', { name: 'Deploy' }));
    expect(persist).not.toHaveBeenCalled();
  });

  it('calls persist when the modal Deploy button is clicked', async () => {
    const persist = vi.fn(async () => ({ branch: 'config/x', headCommit: 'h', commitCount: 1 }));
    render(<WorkspaceBar workspace={makeWorkspace({ persist })} />);

    // Open the modal
    fireEvent.click(screen.getByRole('button', { name: 'Deploy' }));

    // Click the Deploy button INSIDE the modal (now there are two — the bar
    // button is still there but the modal one is also rendered). Find the
    // one inside the dialog.
    const dialog = screen.getByRole('dialog');
    const modalDeployBtn = dialog.querySelector('button:not([class*="text-muted-foreground"])') as HTMLButtonElement;
    expect(modalDeployBtn?.textContent).toBe('Deploy');
    fireEvent.click(modalDeployBtn);

    await waitFor(() => {
      expect(persist).toHaveBeenCalledTimes(1);
    });
  });

  it('closes the modal after a successful persist', async () => {
    render(<WorkspaceBar workspace={makeWorkspace()} />);

    fireEvent.click(screen.getByRole('button', { name: 'Deploy' }));
    expect(screen.getByRole('dialog')).toBeDefined();

    // Click the modal's Deploy button
    const dialog = screen.getByRole('dialog');
    const buttons = dialog.querySelectorAll('button');
    const modalDeployBtn = Array.from(buttons).find((b) => b.textContent === 'Deploy');
    expect(modalDeployBtn).toBeDefined();
    fireEvent.click(modalDeployBtn as HTMLButtonElement);

    // Modal should close
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
  });

  it('shows a success message after a successful persist', async () => {
    const persist = vi.fn(async () => ({
      branch: 'config/sally-1234',
      headCommit: 'abc',
      commitCount: 1,
    }));
    render(<WorkspaceBar workspace={makeWorkspace({ persist })} />);

    fireEvent.click(screen.getByRole('button', { name: 'Deploy' }));
    const dialog = screen.getByRole('dialog');
    const buttons = dialog.querySelectorAll('button');
    const modalDeployBtn = Array.from(buttons).find((b) => b.textContent === 'Deploy');
    fireEvent.click(modalDeployBtn as HTMLButtonElement);

    await waitFor(() => {
      expect(screen.getByText(/Pushed to config\/sally-1234/)).toBeDefined();
    });
  });

  it('keeps the modal open and shows an error message on persist failure', async () => {
    const persist = vi.fn(async () => { throw new Error('Branch already exists'); });
    render(<WorkspaceBar workspace={makeWorkspace({ persist })} />);

    fireEvent.click(screen.getByRole('button', { name: 'Deploy' }));
    const dialog = screen.getByRole('dialog');
    const buttons = dialog.querySelectorAll('button');
    const modalDeployBtn = Array.from(buttons).find((b) => b.textContent === 'Deploy');
    fireEvent.click(modalDeployBtn as HTMLButtonElement);

    await waitFor(() => {
      expect(screen.getByText('Branch already exists')).toBeDefined();
    });
    // Modal stays open so the user can see the error and try again or cancel
    expect(screen.getByRole('dialog')).toBeDefined();
  });

  it('closes the modal when Cancel is clicked', () => {
    render(<WorkspaceBar workspace={makeWorkspace()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Deploy' }));
    expect(screen.getByRole('dialog')).toBeDefined();

    const dialog = screen.getByRole('dialog');
    const buttons = dialog.querySelectorAll('button');
    const cancelBtn = Array.from(buttons).find((b) => b.textContent === 'Cancel');
    fireEvent.click(cancelBtn as HTMLButtonElement);

    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('disables the Deploy button when there are no commits', () => {
    const empty: WorkspaceState = {
      ...makeWorkspace(),
      stored: null,
      isDirty: false,
    };
    render(<WorkspaceBar workspace={empty} />);
    const button = screen.getByRole('button', { name: 'Deploy' });
    expect(button).toHaveProperty('disabled', true);
  });

  it('disables the Deploy button when the workspace is stale', () => {
    render(<WorkspaceBar workspace={makeWorkspace({ isStale: true })} />);
    const button = screen.getByRole('button', { name: 'Deploy' });
    expect(button).toHaveProperty('disabled', true);
  });

  it('renders the locked-by-other-tab message instead of buttons', () => {
    render(<WorkspaceBar workspace={makeWorkspace({ lockedByOtherTab: true })} />);
    expect(screen.getByText(/Editing in another tab/)).toBeDefined();
    expect(screen.queryByRole('button', { name: 'Deploy' })).toBeNull();
  });
});
