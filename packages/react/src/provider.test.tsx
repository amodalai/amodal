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
  const { runtimeUrl, tenantId, client } = useAmodalContext();
  return (
    <div>
      <span data-testid="url">{runtimeUrl}</span>
      <span data-testid="tenant">{tenantId}</span>
      <span data-testid="client">{client ? 'ok' : 'missing'}</span>
    </div>
  );
}

describe('AmodalProvider', () => {
  it('provides runtimeUrl and tenantId to children', () => {
    render(
      <AmodalProvider runtimeUrl={RUNTIME_TEST_URL} tenantId="t1">
        <TestConsumer />
      </AmodalProvider>,
    );
    expect(screen.getByTestId('url').textContent).toBe(RUNTIME_TEST_URL);
    expect(screen.getByTestId('tenant').textContent).toBe('t1');
    expect(screen.getByTestId('client').textContent).toBe('ok');
  });

  it('throws when useAmodalContext is called outside provider', () => {
    // Suppress React error boundary noise
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => render(<TestConsumer />)).toThrow(
      'useAmodalContext must be used within an <AmodalProvider>',
    );
    spy.mockRestore();
  });

  it('creates a new client when runtimeUrl changes', () => {
    const { rerender } = render(
      <AmodalProvider runtimeUrl={RUNTIME_TEST_URL} tenantId="t1">
        <TestConsumer />
      </AmodalProvider>,
    );
    expect(screen.getByTestId('url').textContent).toBe(RUNTIME_TEST_URL);

    rerender(
      <AmodalProvider runtimeUrl="http://other:9999" tenantId="t1">
        <TestConsumer />
      </AmodalProvider>,
    );
    expect(screen.getByTestId('url').textContent).toBe('http://other:9999');
  });

  it('creates a new client when tenantId changes', () => {
    const { rerender } = render(
      <AmodalProvider runtimeUrl={RUNTIME_TEST_URL} tenantId="t1">
        <TestConsumer />
      </AmodalProvider>,
    );
    expect(screen.getByTestId('tenant').textContent).toBe('t1');

    rerender(
      <AmodalProvider runtimeUrl={RUNTIME_TEST_URL} tenantId="t2">
        <TestConsumer />
      </AmodalProvider>,
    );
    expect(screen.getByTestId('tenant').textContent).toBe('t2');
  });

  it('accepts getToken prop', () => {
    render(
      <AmodalProvider runtimeUrl={RUNTIME_TEST_URL} tenantId="t1" getToken={() => 'tok'}>
        <TestConsumer />
      </AmodalProvider>,
    );
    expect(screen.getByTestId('client').textContent).toBe('ok');
  });

  it('renders children', () => {
    render(
      <AmodalProvider runtimeUrl={RUNTIME_TEST_URL} tenantId="t1">
        <div data-testid="child">hello</div>
      </AmodalProvider>,
    );
    expect(screen.getByTestId('child').textContent).toBe('hello');
  });
});
