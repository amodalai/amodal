/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock pg.Client before importing the module under test
const mockClient = {
  connect: vi.fn().mockResolvedValue(undefined),
  query: vi.fn().mockResolvedValue(undefined),
  end: vi.fn().mockResolvedValue(undefined),
  on: vi.fn(),
};

vi.mock('pg', () => ({
  Client: vi.fn(() => mockClient),
}));

// Import after mock setup
const { createPgListener } = await import('../listen.js');

describe('createPgListener', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset the on handler registrations
    mockClient.on.mockImplementation(() => mockClient);
  });

  it('connects the client on creation', async () => {
    await createPgListener('postgres://localhost/test');
    expect(mockClient.connect).toHaveBeenCalledTimes(1);
  });

  it('listen() issues LISTEN query', async () => {
    const listener = await createPgListener('postgres://localhost/test');
    await listener.listen('store_updated');
    expect(mockClient.query).toHaveBeenCalledWith('LISTEN store_updated');
  });

  it('close() ends the client', async () => {
    const listener = await createPgListener('postgres://localhost/test');
    await listener.close();
    expect(mockClient.end).toHaveBeenCalledTimes(1);
  });

  it('emits parsed JSON payloads on notification', async () => {
    // Capture the notification handler registered on the client
    let notificationHandler: ((msg: { channel: string; payload: string }) => void) | undefined;
    mockClient.on.mockImplementation((event: string, handler: (...args: unknown[]) => void) => {
      if (event === 'notification') {
        notificationHandler = handler as typeof notificationHandler;
      }
      return mockClient;
    });

    const listener = await createPgListener('postgres://localhost/test');
    const received: unknown[] = [];
    listener.on('store_updated', (payload) => received.push(payload));

    // Simulate a notification
    expect(notificationHandler).toBeDefined();
    notificationHandler!({
      channel: 'store_updated',
      payload: JSON.stringify({agentId: 'a1', store: 's1', key: 'k1'}),
    });

    expect(received).toHaveLength(1);
    expect(received[0]).toEqual({agentId: 'a1', store: 's1', key: 'k1'});
  });

  it('emits raw string when payload is not valid JSON', async () => {
    let notificationHandler: ((msg: { channel: string; payload: string }) => void) | undefined;
    mockClient.on.mockImplementation((event: string, handler: (...args: unknown[]) => void) => {
      if (event === 'notification') {
        notificationHandler = handler as typeof notificationHandler;
      }
      return mockClient;
    });

    const listener = await createPgListener('postgres://localhost/test');
    const received: unknown[] = [];
    listener.on('store_updated', (payload) => received.push(payload));

    notificationHandler!({
      channel: 'store_updated',
      payload: 'not-json',
    });

    expect(received).toHaveLength(1);
    expect(received[0]).toBe('not-json');
  });

  it('off() removes the handler', async () => {
    let notificationHandler: ((msg: { channel: string; payload: string }) => void) | undefined;
    mockClient.on.mockImplementation((event: string, handler: (...args: unknown[]) => void) => {
      if (event === 'notification') {
        notificationHandler = handler as typeof notificationHandler;
      }
      return mockClient;
    });

    const listener = await createPgListener('postgres://localhost/test');
    const received: unknown[] = [];
    const handler = (payload: unknown): void => {
      received.push(payload);
    };
    listener.on('store_updated', handler);
    listener.off('store_updated', handler);

    notificationHandler!({
      channel: 'store_updated',
      payload: JSON.stringify({test: true}),
    });

    expect(received).toHaveLength(0);
  });
});
