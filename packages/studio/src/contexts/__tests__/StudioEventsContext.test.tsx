/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import React from 'react';

// ---------------------------------------------------------------------------
// Mock EventSource
// ---------------------------------------------------------------------------

type ESListener = (e: { data: string }) => void;

class MockEventSource {
  static instances: MockEventSource[] = [];
  private listeners = new Map<string, ESListener[]>();
  url: string;

  constructor(url: string) {
    this.url = url;
    MockEventSource.instances.push(this);
  }

  addEventListener(type: string, listener: ESListener): void {
    if (!this.listeners.has(type)) {
      this.listeners.set(type, []);
    }
    this.listeners.get(type)!.push(listener);
  }

  close(): void {
    this.listeners.clear();
  }

  /** Test helper -- simulate an SSE event from the server */
  simulateEvent(type: string, data: string): void {
    const handlers = this.listeners.get(type) ?? [];
    for (const handler of handlers) {
      handler({ data });
    }
  }
}

// Install the mock globally
const originalEventSource = globalThis.EventSource;

beforeEach(() => {
  MockEventSource.instances = [];
  (globalThis as Record<string, unknown>)['EventSource'] = MockEventSource;
});

afterEach(() => {
  (globalThis as Record<string, unknown>)['EventSource'] = originalEventSource;
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('StudioEventsContext', () => {
  it('exports StudioEventsProvider as a valid React component', async () => {
    const { StudioEventsProvider } = await import('../StudioEventsContext');

    // Verify it can be used to create an element
    const element = React.createElement(
      StudioEventsProvider,
      null,
      React.createElement('span', null, 'child'),
    );
    expect(element).toBeDefined();
    expect(element.type).toBe(StudioEventsProvider);
  });

  it('exports useStudioEvents hook', async () => {
    const { useStudioEvents } = await import('../StudioEventsContext');
    expect(typeof useStudioEvents).toBe('function');
  });

  it('MockEventSource dispatches to listeners correctly', () => {
    const es = new MockEventSource('/api/studio/events');
    const received: string[] = [];

    es.addEventListener('store_updated', (e) => {
      received.push(e.data);
    });

    es.simulateEvent('store_updated', '{"store":"users"}');

    expect(received).toEqual(['{"store":"users"}']);
  });

  it('MockEventSource close clears listeners', () => {
    const es = new MockEventSource('/api/studio/events');
    const received: string[] = [];

    es.addEventListener('store_updated', (e) => {
      received.push(e.data);
    });

    es.close();
    es.simulateEvent('store_updated', '{"store":"users"}');

    expect(received).toEqual([]);
  });
});
