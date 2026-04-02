/**
 * @license
 * Copyright 2025 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AmodalProvider, useAmodalContext } from './provider';
import { RUNTIME_TEST_URL } from '../test/mocks/handlers';

function TestConsumer() {
  const { runtimeUrl, client } = useAmodalContext();
  return (
    <div>
      <span data-testid="url">{runtimeUrl}</span>
      <span data-testid="client">{client ? 'ok' : 'missing'}</span>
    </div>
  );
}

describe('AmodalProvider', () => {
  it('provides runtimeUrl and client to children', () => {
    render(
      <AmodalProvider runtimeUrl={RUNTIME_TEST_URL}>
        <TestConsumer />
      </AmodalProvider>,
    );
    expect(screen.getByTestId('url').textContent).toBe(RUNTIME_TEST_URL);
    expect(screen.getByTestId('client').textContent).toBe('ok');
  });

  it('throws when useAmodalContext is called outside provider', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => render(<TestConsumer />)).toThrow(
      'useAmodalContext must be used within an <AmodalProvider>',
    );
    spy.mockRestore();
  });

  it('creates a new client when runtimeUrl changes', () => {
    const { rerender } = render(
      <AmodalProvider runtimeUrl={RUNTIME_TEST_URL}>
        <TestConsumer />
      </AmodalProvider>,
    );
    expect(screen.getByTestId('url').textContent).toBe(RUNTIME_TEST_URL);

    rerender(
      <AmodalProvider runtimeUrl="http://other:9999">
        <TestConsumer />
      </AmodalProvider>,
    );
    expect(screen.getByTestId('url').textContent).toBe('http://other:9999');
  });

  it('accepts getToken prop', () => {
    render(
      <AmodalProvider runtimeUrl={RUNTIME_TEST_URL} getToken={() => 'tok'}>
        <TestConsumer />
      </AmodalProvider>,
    );
    expect(screen.getByTestId('client').textContent).toBe('ok');
  });

  it('renders children', () => {
    render(
      <AmodalProvider runtimeUrl={RUNTIME_TEST_URL}>
        <div data-testid="child">hello</div>
      </AmodalProvider>,
    );
    expect(screen.getByTestId('child').textContent).toBe('hello');
  });
});
