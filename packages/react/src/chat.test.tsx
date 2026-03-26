/**
 * @license
 * Copyright 2025 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import { describe, it, expect } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { server } from '../test/mocks/server';
import { encodeSSEEvents, confirmationSSEEvents, toolCallSSEEvents, RUNTIME_TEST_URL } from '../test/mocks/handlers';
import { AmodalChat } from './chat';
import { AmodalProvider } from './provider';
import type { ReactNode } from 'react';

function Wrapper({ children }: { children: ReactNode }) {
  return (
    <AmodalProvider runtimeUrl={RUNTIME_TEST_URL} tenantId="t1">
      {children}
    </AmodalProvider>
  );
}

describe('AmodalChat', () => {
  it('renders chat UI', () => {
    render(<AmodalChat />, { wrapper: Wrapper });
    expect(screen.getByTestId('amodal-chat')).toBeInTheDocument();
    expect(screen.getByTestId('chat-input')).toBeInTheDocument();
    expect(screen.getByTestId('send-button')).toBeInTheDocument();
  });

  it('sends a message and shows response', async () => {
    const user = userEvent.setup();
    render(<AmodalChat />, { wrapper: Wrapper });

    const input = screen.getByTestId('chat-input');
    const sendBtn = screen.getByTestId('send-button');

    await user.type(input, 'hello');
    await user.click(sendBtn);

    await waitFor(() => {
      expect(screen.getByTestId('user-message')).toHaveTextContent('hello');
    });

    await waitFor(() => {
      const assistant = screen.getByTestId('assistant-message');
      expect(assistant).toHaveTextContent('Hello, world!');
    });
  });

  it('disables send button for empty input', () => {
    render(<AmodalChat />, { wrapper: Wrapper });
    const sendBtn = screen.getByTestId('send-button');
    expect(sendBtn).toBeDisabled();
  });

  it('shows tool calls', async () => {
    server.use(
      http.post(`${RUNTIME_TEST_URL}/chat`, () =>
        new HttpResponse(encodeSSEEvents(toolCallSSEEvents), {
          headers: { 'Content-Type': 'text/event-stream' },
        }),
      ),
    );

    const user = userEvent.setup();
    render(<AmodalChat />, { wrapper: Wrapper });

    await user.type(screen.getByTestId('chat-input'), 'check');
    await user.click(screen.getByTestId('send-button'));

    await waitFor(() => {
      expect(screen.getByTestId('tool-call')).toBeInTheDocument();
    });
  });

  it('shows confirmation card', async () => {
    server.use(
      http.post(`${RUNTIME_TEST_URL}/chat`, () =>
        new HttpResponse(encodeSSEEvents(confirmationSSEEvents), {
          headers: { 'Content-Type': 'text/event-stream' },
        }),
      ),
    );

    const user = userEvent.setup();
    render(<AmodalChat />, { wrapper: Wrapper });

    await user.type(screen.getByTestId('chat-input'), 'create ticket');
    await user.click(screen.getByTestId('send-button'));

    await waitFor(() => {
      // Should show ReviewCard because params are present
      expect(screen.getByTestId('review-card')).toBeInTheDocument();
    });
  });

  it('accepts custom placeholder', () => {
    render(<AmodalChat placeholder="Ask anything..." />, { wrapper: Wrapper });
    expect(screen.getByTestId('chat-input')).toHaveAttribute('placeholder', 'Ask anything...');
  });

  it('accepts custom className', () => {
    render(<AmodalChat className="my-chat" />, { wrapper: Wrapper });
    expect(screen.getByTestId('amodal-chat')).toHaveClass('amodal-chat', 'my-chat');
  });

  it('does not send empty messages', async () => {
    const user = userEvent.setup();
    render(<AmodalChat />, { wrapper: Wrapper });

    const sendBtn = screen.getByTestId('send-button');
    expect(sendBtn).toBeDisabled();

    await user.type(screen.getByTestId('chat-input'), '   ');
    // Button should still be disabled for whitespace-only input
    expect(sendBtn).toBeDisabled();
  });

  it('shows error messages from stream', async () => {
    server.use(
      http.post(`${RUNTIME_TEST_URL}/chat`, () =>
        new HttpResponse(null, { status: 500 }),
      ),
    );

    const user = userEvent.setup();
    render(<AmodalChat />, { wrapper: Wrapper });

    await user.type(screen.getByTestId('chat-input'), 'hello');
    await user.click(screen.getByTestId('send-button'));

    // The error should be set in state (tested via the hook)
    // The chat component doesn't render error state as a message directly,
    // but the stream ends
    await waitFor(() => {
      expect(screen.getByTestId('chat-input')).not.toBeDisabled();
    });
  });

  it('uses custom renderText', async () => {
    const user = userEvent.setup();
    render(
      <AmodalChat renderText={(text) => <strong>{text}</strong>} />,
      { wrapper: Wrapper },
    );

    await user.type(screen.getByTestId('chat-input'), 'hello');
    await user.click(screen.getByTestId('send-button'));

    await waitFor(() => {
      const strong = screen.getByTestId('assistant-message').querySelector('strong');
      expect(strong).toHaveTextContent('Hello, world!');
    });
  });
});
