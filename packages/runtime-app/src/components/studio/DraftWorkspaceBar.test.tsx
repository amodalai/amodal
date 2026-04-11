/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { DraftWorkspaceBar } from './DraftWorkspaceBar';
import type {
  UseDraftWorkspace,
  DraftFile,
  PublishResult,
} from '../../hooks/useDraftWorkspace';
import { StudioFetchError } from '../../hooks/useDraftWorkspace';

// Keep a stable reference to the real fetch so we can restore after the
// suite. The hook's initial mount call would otherwise hit an undefined
// global and throw during unrelated tests.
const originalFetch = globalThis.fetch;

beforeEach(() => {
  // Every render of DraftWorkspaceBar without a fake workspace triggers an
  // initial `listDrafts` fetch. Stub it with an empty-drafts response so
  // the hook doesn't error out even when we immediately override the state
  // via the `workspace` prop.
  globalThis.fetch = vi.fn(async () =>
    new Response(JSON.stringify({ drafts: [] }), { status: 200 }),
  ) as unknown as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function makeFakeWorkspace(
  overrides: Partial<UseDraftWorkspace> = {},
): UseDraftWorkspace {
  // Default getLatestError mirrors whatever `error` the override sets, so
  // tests that pass `error: someErr` get a matching synchronous getter
  // automatically. Tests can override this explicitly when they need the
  // ref-based value to differ from the state-based value.
  const defaultError = overrides.error ?? null;
  return {
    drafts: [],
    count: 0,
    isLoading: false,
    error: null,
    getLatestError: (): Error | null => defaultError,
    listDrafts: vi.fn(async () => undefined),
    saveDraft: vi.fn(async () => undefined),
    deleteDraft: vi.fn(async () => undefined),
    discardAll: vi.fn(async () => undefined),
    publish: vi.fn(async () => null),
    buildPreview: vi.fn(async () => null),
    ...overrides,
  };
}

const oneDraft: DraftFile[] = [
  { filePath: 'skills/pricing.md', content: '#', updatedAt: '2026-01-01T00:00:00Z' },
];
const threeDrafts: DraftFile[] = [
  { filePath: 'skills/a.md', content: '', updatedAt: '2026-01-01T00:00:00Z' },
  { filePath: 'skills/b.md', content: '', updatedAt: '2026-01-02T00:00:00Z' },
  { filePath: 'skills/c.md', content: '', updatedAt: '2026-01-03T00:00:00Z' },
];

describe('DraftWorkspaceBar', () => {
  it('shows the empty state when there are no drafts', () => {
    render(<DraftWorkspaceBar workspace={makeFakeWorkspace()} />);
    expect(screen.getByText('No pending changes')).toBeDefined();
  });

  it('shows "N unpublished changes" when drafts exist', () => {
    render(
      <DraftWorkspaceBar
        workspace={makeFakeWorkspace({ drafts: threeDrafts, count: 3 })}
      />,
    );
    expect(screen.getByText('3 unpublished changes')).toBeDefined();
  });

  it('uses singular wording for count === 1', () => {
    render(
      <DraftWorkspaceBar
        workspace={makeFakeWorkspace({ drafts: oneDraft, count: 1 })}
      />,
    );
    expect(screen.getByText('1 unpublished change')).toBeDefined();
  });

  it('disables all action buttons when there are no drafts', () => {
    render(<DraftWorkspaceBar workspace={makeFakeWorkspace()} />);
    expect((screen.getByRole('button', { name: 'Discard' })).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'Preview' })).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'Publish' })).disabled).toBe(true);
  });

  it('enables action buttons when drafts exist', () => {
    render(
      <DraftWorkspaceBar
        workspace={makeFakeWorkspace({ drafts: oneDraft, count: 1 })}
      />,
    );
    expect((screen.getByRole('button', { name: 'Discard' })).disabled).toBe(false);
    expect((screen.getByRole('button', { name: 'Preview' })).disabled).toBe(false);
    expect((screen.getByRole('button', { name: 'Publish' })).disabled).toBe(false);
  });

  it('opens the DiscardDialog when Discard is clicked', () => {
    render(
      <DraftWorkspaceBar
        workspace={makeFakeWorkspace({ drafts: oneDraft, count: 1 })}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Discard' }));
    // Dialog's header text is unique enough to assert on.
    expect(screen.getByText('Discard unpublished changes?')).toBeDefined();
  });

  it('opens the PublishDialog when Publish is clicked', () => {
    render(
      <DraftWorkspaceBar
        workspace={makeFakeWorkspace({ drafts: oneDraft, count: 1 })}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Publish' }));
    expect(screen.getByText('Publish changes')).toBeDefined();
    expect(screen.getByText('skills/pricing.md')).toBeDefined();
  });

  it('calls buildPreview when Preview is clicked and opens a new tab on success', async () => {
    const buildPreview = vi.fn(async () => ({
      snapshotId: 'snap-1',
      previewToken: 'tok-123',
      expiresAt: '2099-01-01T00:00:00Z',
    }));
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);
    render(
      <DraftWorkspaceBar
        workspace={makeFakeWorkspace({ drafts: oneDraft, count: 1, buildPreview })}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Preview' }));
    await waitFor(() => {
      expect(buildPreview).toHaveBeenCalled();
    });
    await waitFor(() => {
      expect(openSpy).toHaveBeenCalledWith(
        expect.stringContaining('preview=tok-123'),
        '_blank',
        expect.any(String),
      );
    });
    openSpy.mockRestore();
  });

  it('shows a friendly message when buildPreview fails with 501 feature_unavailable', async () => {
    const err = new StudioFetchError('feature unavailable', 501, 'feature_unavailable');
    const buildPreview = vi.fn(async () => null);
    // The bar reads the post-mutation error via `getLatestError()` rather than
    // the closure-captured `error` field, so the fake workspace needs to
    // return `err` from that getter. We intentionally leave `error: null`
    // here — in production the hook's state `error` is the trailing value
    // from the previous render, not the just-caught one, and the bar must
    // rely on the ref-based getter to see the fresh error synchronously.
    const workspace = makeFakeWorkspace({
      drafts: oneDraft,
      count: 1,
      buildPreview,
      error: null,
      getLatestError: (): Error | null => err,
    });
    render(<DraftWorkspaceBar workspace={workspace} />);
    fireEvent.click(screen.getByRole('button', { name: 'Preview' }));
    await waitFor(() => {
      expect(screen.getByText(/Preview is only available in cloud/)).toBeDefined();
    });
  });

  it('renders an inline error banner from workspace.error', () => {
    render(
      <DraftWorkspaceBar
        workspace={makeFakeWorkspace({
          drafts: oneDraft,
          count: 1,
          error: new Error('network down'),
        })}
      />,
    );
    expect(screen.getByText('network down')).toBeDefined();
  });

  it('calls publish from the PublishDialog flow', async () => {
    const publish = vi.fn(
      async (): Promise<PublishResult | null> => ({ commitSha: 'abc1234xyz' }),
    );
    render(
      <DraftWorkspaceBar
        workspace={makeFakeWorkspace({ drafts: oneDraft, count: 1, publish })}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Publish' }));
    const textarea = screen.getByPlaceholderText('Update pricing skill');
    fireEvent.change(textarea, { target: { value: 'fix typo' } });
    fireEvent.click(screen.getByRole('button', { name: 'Commit' }));
    await waitFor(() => {
      expect(publish).toHaveBeenCalledWith('fix typo');
    });
  });
});
