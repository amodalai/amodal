/**
 * @license
 * Copyright 2025 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AmodalChat } from './chat';

describe('AmodalChat', () => {
  it('renders as a thin wrapper around ChatWidget with inline positioning', () => {
    render(
      <AmodalChat serverUrl="http://localhost:3000" user={{ id: 'test-user' }} />,
    );
    expect(screen.getByTestId('amodal-chat')).toBeInTheDocument();
    expect(screen.getByTestId('chat-widget')).toBeInTheDocument();
  });

  it('passes className to the wrapper div', () => {
    render(
      <AmodalChat serverUrl="http://localhost:3000" user={{ id: 'test-user' }} className="my-chat" />,
    );
    expect(screen.getByTestId('amodal-chat')).toHaveClass('my-chat');
  });

  it('renders the widget with inline position class', () => {
    render(
      <AmodalChat serverUrl="http://localhost:3000" user={{ id: 'test-user' }} />,
    );
    const widget = screen.getByTestId('chat-widget');
    expect(widget).toHaveClass('pcw-widget--inline');
  });
});
