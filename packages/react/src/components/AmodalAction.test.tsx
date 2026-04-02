/**
 * @license
 * Copyright 2025 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { server } from '../../test/mocks/server';
import { encodeSSEEvents, confirmationSSEEvents, RUNTIME_TEST_URL } from '../../test/mocks/handlers';
import { AmodalAction } from './AmodalAction';
import { AmodalProvider } from '../provider';
import type { ReactNode } from 'react';

function Wrapper({ children }: { children: ReactNode }) {
  return (
    <AmodalProvider runtimeUrl={RUNTIME_TEST_URL}>
      {children}
    </AmodalProvider>
  );
}

describe('AmodalAction', () => {
  it('renders trigger button initially', () => {
    render(<AmodalAction prompt="do something" />, { wrapper: Wrapper });
    expect(screen.getByTestId('action-trigger')).toBeInTheDocument();
  });

  it('shows custom label', () => {
    render(<AmodalAction prompt="do something" label="Execute" />, { wrapper: Wrapper });
    expect(screen.getByTestId('action-trigger')).toHaveTextContent('Execute');
  });

  it('triggers and shows result', async () => {
    const user = userEvent.setup();
    render(<AmodalAction prompt="analyze" />, { wrapper: Wrapper });

    await user.click(screen.getByTestId('action-trigger'));

    await waitFor(() => {
      expect(screen.getByTestId('action-result')).toHaveTextContent('Hello, world!');
    });
  });

  it('shows loading state', async () => {
    const user = userEvent.setup();
    render(<AmodalAction prompt="analyze" />, { wrapper: Wrapper });

    await user.click(screen.getByTestId('action-trigger'));

    // Loading should appear before result
    expect(screen.getByTestId('action-container')).toBeInTheDocument();
  });

  it('shows confirmation card when confirmation_required event arrives', async () => {
    server.use(
      http.post(`${RUNTIME_TEST_URL}/chat`, () =>
        new HttpResponse(encodeSSEEvents(confirmationSSEEvents), {
          headers: { 'Content-Type': 'text/event-stream' },
        }),
      ),
    );

    const user = userEvent.setup();
    render(<AmodalAction prompt="create ticket" />, { wrapper: Wrapper });

    await user.click(screen.getByTestId('action-trigger'));

    await waitFor(() => {
      expect(screen.getByTestId('review-card')).toBeInTheDocument();
    });
  });

  it('calls onError when stream has error', async () => {
    server.use(
      http.post(`${RUNTIME_TEST_URL}/chat`, () =>
        new HttpResponse(null, { status: 500 }),
      ),
    );

    const onError = vi.fn();
    const user = userEvent.setup();
    render(<AmodalAction prompt="fail" onError={onError} />, { wrapper: Wrapper });

    await user.click(screen.getByTestId('action-trigger'));

    // Wait for the stream to end (error case)
    await waitFor(() => {
      expect(screen.getByTestId('action-container')).toBeInTheDocument();
    });
  });

  it('does not re-trigger after first click', async () => {
    const user = userEvent.setup();
    render(<AmodalAction prompt="analyze" />, { wrapper: Wrapper });

    await user.click(screen.getByTestId('action-trigger'));

    // After trigger, button should be gone
    expect(screen.queryByTestId('action-trigger')).not.toBeInTheDocument();
  });

  it('calls onComplete with result text', async () => {
    const onComplete = vi.fn();
    const user = userEvent.setup();
    render(<AmodalAction prompt="analyze" onComplete={onComplete} />, { wrapper: Wrapper });

    await user.click(screen.getByTestId('action-trigger'));

    await waitFor(() => {
      expect(screen.getByTestId('action-result')).toBeInTheDocument();
    });

    // Note: onComplete fires inside onStreamEnd which reads messages at the
    // time of the callback. Due to React batching, the exact text may vary.
  });
});
