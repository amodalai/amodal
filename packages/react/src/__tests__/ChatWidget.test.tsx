/**
 * @license
 * Copyright 2025 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { ChatWidget } from '../widget/ChatWidget';
import { server } from '../test/mocks/server';
import { encodeSSEEvents, widgetToolCallSSEEvents as toolCallSSEEvents, skillAndKBSSEEvents, widgetSSEEvents } from '../test/mocks/handlers';
import type { WidgetEvent } from '../events/types';

const defaultProps = {
  serverUrl: 'http://localhost:4555',
  user: { id: 'analyst-1', role: 'analyst' },
};

describe('ChatWidget', () => {
  describe('inline position', () => {
    it('renders inline widget', () => {
      render(<ChatWidget {...defaultProps} position="inline" />);
      expect(screen.getByTestId('chat-widget')).toBeInTheDocument();
      expect(screen.getByText('AI Assistant')).toBeInTheDocument();
    });

    it('shows custom header text', () => {
      render(
        <ChatWidget
          {...defaultProps}
          position="inline"
          theme={{ headerText: 'Investigation' }}
        />,
      );
      expect(screen.getByText('Investigation')).toBeInTheDocument();
    });

    it('shows empty state message', () => {
      render(<ChatWidget {...defaultProps} position="inline" />);
      expect(screen.getByText('Send a message to start a conversation.')).toBeInTheDocument();
    });

    it('sends a message and displays response', async () => {
      const user = userEvent.setup();
      render(<ChatWidget {...defaultProps} position="inline" />);

      const input = screen.getByPlaceholderText('Type a message...');
      await user.type(input, 'hello');
      await user.click(screen.getByLabelText('Send message'));

      // User message should appear
      expect(screen.getByText('hello')).toBeInTheDocument();

      // Wait for the response text to be streamed
      const response = await screen.findByText('Hello, world!');
      expect(response).toBeInTheDocument();
    });

    it('shows tool calls in response', async () => {
      server.use(
        http.post('http://localhost:4555/chat/stream', () =>
          new HttpResponse(encodeSSEEvents(toolCallSSEEvents), {
            headers: { 'Content-Type': 'text/event-stream' },
          }),
        ),
      );

      const user = userEvent.setup();
      render(<ChatWidget {...defaultProps} position="inline" />);

      const input = screen.getByPlaceholderText('Type a message...');
      await user.type(input, 'check zone');
      await user.click(screen.getByLabelText('Send message'));

      // Wait for tool call to appear
      const toolCall = await screen.findByText(/shell_exec/);
      expect(toolCall).toBeInTheDocument();
    });

    it('shows skill pills and KB proposals', async () => {
      server.use(
        http.post('http://localhost:4555/chat/stream', () =>
          new HttpResponse(encodeSSEEvents(skillAndKBSSEEvents), {
            headers: { 'Content-Type': 'text/event-stream' },
          }),
        ),
      );

      const user = userEvent.setup();
      render(<ChatWidget {...defaultProps} position="inline" />);

      const input = screen.getByPlaceholderText('Type a message...');
      await user.type(input, 'investigate');
      await user.click(screen.getByLabelText('Send message'));

      // Wait for skill pill
      const skillPill = await screen.findByText('Using: triage');
      expect(skillPill).toBeInTheDocument();

      // KB proposal should appear
      const proposal = await screen.findByText('Rogue sensor in Zone C');
      expect(proposal).toBeInTheDocument();
      expect(screen.getByText('segment')).toBeInTheDocument();
    });

    it('supports Enter to send', async () => {
      const user = userEvent.setup();
      render(<ChatWidget {...defaultProps} position="inline" />);

      const input = screen.getByPlaceholderText('Type a message...');
      await user.type(input, 'hello{Enter}');

      expect(screen.getByText('hello')).toBeInTheDocument();
    });

    it('supports Shift+Enter for newline', async () => {
      const user = userEvent.setup();
      render(<ChatWidget {...defaultProps} position="inline" />);

      const input = screen.getByPlaceholderText('Type a message...');
      await user.type(input, 'line1{Shift>}{Enter}{/Shift}line2');

      expect(input).toHaveValue('line1\nline2');
    });

    it('shows stop button while streaming', async () => {
      server.use(
        http.post('http://localhost:4555/chat/stream', async () => {
          await new Promise((resolve) => setTimeout(resolve, 500));
          return new HttpResponse(encodeSSEEvents([
            { type: 'init', session_id: 's1', timestamp: 't' },
            { type: 'done', timestamp: 't' },
          ]), {
            headers: { 'Content-Type': 'text/event-stream' },
          });
        }),
      );

      const user = userEvent.setup();
      render(<ChatWidget {...defaultProps} position="inline" />);

      const input = screen.getByPlaceholderText('Type a message...');
      await user.type(input, 'hello');
      await user.click(screen.getByLabelText('Send message'));

      // Send button replaced by stop button during streaming
      expect(screen.getByLabelText('Stop generating')).toBeInTheDocument();
      expect(screen.queryByLabelText('Send message')).not.toBeInTheDocument();
    });

    it('has a new conversation button', async () => {
      const user = userEvent.setup();
      render(<ChatWidget {...defaultProps} position="inline" />);

      const input = screen.getByPlaceholderText('Type a message...');
      await user.type(input, 'hello{Enter}');

      // Wait for response
      await screen.findByText('hello');

      // Click reset button
      const resetBtn = screen.getByLabelText('New conversation');
      await user.click(resetBtn);

      // Should show empty state again
      expect(screen.getByText('Send a message to start a conversation.')).toBeInTheDocument();
    });
  });

  describe('floating position', () => {
    it('shows toggle button when closed', () => {
      render(<ChatWidget {...defaultProps} position="floating" />);
      expect(screen.getByLabelText('Open chat')).toBeInTheDocument();
      expect(screen.queryByTestId('chat-widget')).not.toBeInTheDocument();
    });

    it('opens when toggle is clicked', async () => {
      const user = userEvent.setup();
      render(<ChatWidget {...defaultProps} position="floating" />);

      await user.click(screen.getByLabelText('Open chat'));
      expect(screen.getByTestId('chat-widget')).toBeInTheDocument();
    });

    it('opens by default when defaultOpen is true', () => {
      render(<ChatWidget {...defaultProps} position="floating" defaultOpen />);
      expect(screen.getByTestId('chat-widget')).toBeInTheDocument();
    });

    it('has a close button', async () => {
      const user = userEvent.setup();
      render(<ChatWidget {...defaultProps} position="floating" defaultOpen />);

      expect(screen.getByTestId('chat-widget')).toBeInTheDocument();
      await user.click(screen.getByLabelText('Close chat'));
      expect(screen.queryByTestId('chat-widget')).not.toBeInTheDocument();
    });
  });

  describe('right position', () => {
    it('opens by default when defaultOpen', () => {
      render(<ChatWidget {...defaultProps} position="right" defaultOpen />);
      const widget = screen.getByTestId('chat-widget');
      expect(widget).toBeInTheDocument();
      expect(widget.className).toContain('pcw-widget--right');
    });
  });

  describe('error handling', () => {
    it('displays error message', async () => {
      server.use(
        http.post('http://localhost:4555/chat/stream', () =>
          new HttpResponse(null, { status: 500, statusText: 'Server Error' }),
        ),
      );

      const user = userEvent.setup();
      render(<ChatWidget {...defaultProps} position="inline" />);

      const input = screen.getByPlaceholderText('Type a message...');
      await user.type(input, 'fail{Enter}');

      // Error should appear
      const error = await screen.findByText(/500/);
      expect(error).toBeInTheDocument();
    });
  });

  describe('theme', () => {
    it('applies custom placeholder', () => {
      render(
        <ChatWidget
          {...defaultProps}
          position="inline"
          theme={{ placeholder: 'Ask a question...' }}
        />,
      );
      expect(screen.getByPlaceholderText('Ask a question...')).toBeInTheDocument();
    });
  });

  describe('onEvent prop', () => {
    it('fires onEvent for tool_executed events', async () => {
      server.use(
        http.post('http://localhost:4555/chat/stream', () =>
          new HttpResponse(encodeSSEEvents(toolCallSSEEvents), {
            headers: { 'Content-Type': 'text/event-stream' },
          }),
        ),
      );

      const events: WidgetEvent[] = [];
      const onEvent = vi.fn((e: WidgetEvent) => { events.push(e); });

      const user = userEvent.setup();
      render(<ChatWidget {...defaultProps} position="inline" onEvent={onEvent} />);

      const input = screen.getByPlaceholderText('Type a message...');
      await user.type(input, 'check zone{Enter}');

      // Wait for streaming to finish
      await screen.findByText(/Found 3 devices/);

      const toolEvents = events.filter((e) => e.type === 'tool_executed');
      expect(toolEvents).toHaveLength(1);
      if (toolEvents[0].type === 'tool_executed') {
        expect(toolEvents[0].toolName).toBe('shell_exec');
      }
    });

    it('fires onEvent for widget_rendered events', async () => {
      server.use(
        http.post('http://localhost:4555/chat/stream', () =>
          new HttpResponse(encodeSSEEvents(widgetSSEEvents), {
            headers: { 'Content-Type': 'text/event-stream' },
          }),
        ),
      );

      const events: WidgetEvent[] = [];
      const onEvent = vi.fn((e: WidgetEvent) => { events.push(e); });

      const user = userEvent.setup();
      render(<ChatWidget {...defaultProps} position="inline" onEvent={onEvent} />);

      const input = screen.getByPlaceholderText('Type a message...');
      await user.type(input, 'investigate{Enter}');

      // Wait for streaming to complete — the response includes "I found a suspicious device"
      await screen.findByText(/suspicious device/i);

      const widgetEvents = events.filter((e) => e.type === 'widget_rendered');
      expect(widgetEvents.length).toBeGreaterThanOrEqual(1);
    });
  });
});
