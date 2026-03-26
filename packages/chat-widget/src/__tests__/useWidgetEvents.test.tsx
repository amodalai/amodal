/**
 * @license
 * Copyright 2025 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useWidgetEvents } from '../hooks/useWidgetEvents';
import { WidgetEventBus } from '../events/event-bus';
import type { ToolExecutedEvent, EntityHoveredEvent } from '../events/types';

describe('useWidgetEvents', () => {
  let bus: WidgetEventBus;

  beforeEach(() => {
    bus = new WidgetEventBus();
  });

  it('subscribes to typed events via on()', () => {
    const handler = vi.fn();
    const { result } = renderHook(() => useWidgetEvents(bus));

    act(() => {
      result.current.on('tool_executed', handler);
    });

    const event: ToolExecutedEvent = {
      type: 'tool_executed',
      toolName: 'shell_exec',
      toolId: 'tc-1',
      parameters: {},
      status: 'success',
      timestamp: new Date().toISOString(),
    };
    act(() => {
      bus.processEvent(event);
    });

    expect(handler).toHaveBeenCalledWith(event);
  });

  it('subscribes to all events via onAny()', () => {
    const handler = vi.fn();
    const { result } = renderHook(() => useWidgetEvents(bus));

    act(() => {
      result.current.onAny(handler);
    });

    const event: EntityHoveredEvent = {
      type: 'entity_hovered',
      entity: { entityType: 'device', entityId: 'AA:BB', source: 'test' },
      timestamp: new Date().toISOString(),
    };
    act(() => {
      bus.emitInteraction(event);
    });

    expect(handler).toHaveBeenCalledWith(event);
  });

  it('manual unsubscribe stops receiving events', () => {
    const handler = vi.fn();
    const { result } = renderHook(() => useWidgetEvents(bus));

    let unsub: () => void;
    act(() => {
      unsub = result.current.on('tool_executed', handler);
    });

    act(() => {
      unsub();
    });

    const event: ToolExecutedEvent = {
      type: 'tool_executed',
      toolName: 'test',
      toolId: 'tc-1',
      parameters: {},
      status: 'success',
      timestamp: new Date().toISOString(),
    };
    act(() => {
      bus.processEvent(event);
    });

    expect(handler).not.toHaveBeenCalled();
  });

  it('cleans up all subscriptions on unmount', () => {
    const handler = vi.fn();
    const { result, unmount } = renderHook(() => useWidgetEvents(bus));

    act(() => {
      result.current.on('tool_executed', handler);
      result.current.onAny(handler);
    });

    unmount();

    const event: ToolExecutedEvent = {
      type: 'tool_executed',
      toolName: 'test',
      toolId: 'tc-1',
      parameters: {},
      status: 'success',
      timestamp: new Date().toISOString(),
    };
    bus.processEvent(event);

    expect(handler).not.toHaveBeenCalled();
  });

  it('handles null eventBus gracefully', () => {
    const handler = vi.fn();
    const { result } = renderHook(() => useWidgetEvents(null));

    act(() => {
      const unsub = result.current.on('tool_executed', handler);
      unsub(); // Should not throw
    });

    expect(handler).not.toHaveBeenCalled();
  });

  it('handles undefined eventBus gracefully', () => {
    const handler = vi.fn();
    const { result } = renderHook(() => useWidgetEvents(undefined));

    act(() => {
      const unsub = result.current.onAny(handler);
      unsub(); // Should not throw
    });

    expect(handler).not.toHaveBeenCalled();
  });

  it('multiple subscriptions to same event type all fire', () => {
    const handler1 = vi.fn();
    const handler2 = vi.fn();
    const { result } = renderHook(() => useWidgetEvents(bus));

    act(() => {
      result.current.on('entity_hovered', handler1);
      result.current.on('entity_hovered', handler2);
    });

    const event: EntityHoveredEvent = {
      type: 'entity_hovered',
      entity: { entityType: 'device', entityId: 'AA:BB', source: 'test' },
      timestamp: new Date().toISOString(),
    };
    act(() => {
      bus.emitInteraction(event);
    });

    expect(handler1).toHaveBeenCalledWith(event);
    expect(handler2).toHaveBeenCalledWith(event);
  });

  it('onAny unsubscribe stops wildcard events', () => {
    const handler = vi.fn();
    const { result } = renderHook(() => useWidgetEvents(bus));

    let unsub: () => void;
    act(() => {
      unsub = result.current.onAny(handler);
    });

    act(() => {
      unsub();
    });

    const event: EntityHoveredEvent = {
      type: 'entity_hovered',
      entity: { entityType: 'device', entityId: 'AA:BB', source: 'test' },
      timestamp: new Date().toISOString(),
    };
    act(() => {
      bus.emitInteraction(event);
    });

    expect(handler).not.toHaveBeenCalled();
  });
});
