/**
 * @license
 * Copyright 2025 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { defaultEntityExtractor } from '../events/entity-extractor';
import { WidgetEventBus } from '../events/event-bus';
import type {
  WidgetEvent,
  ToolExecutedEvent,
  WidgetRenderedEvent,
  SkillActivatedEvent,
  KBProposalEvent,
  EntityHoveredEvent,
  EntityUnhoveredEvent,
  EntityClickedEvent,
  EntityReferencedEvent,
} from '../events/types';

// ---------------------------------------------------------------------------
// defaultEntityExtractor
// ---------------------------------------------------------------------------

describe('defaultEntityExtractor', () => {
  it('extracts device and zone from entity-card widget', () => {
    const event: WidgetRenderedEvent = {
      type: 'widget_rendered',
      widgetType: 'entity-card',
      data: { mac: 'AA:BB:CC:DD:EE:01', zone: 'A', manufacturer: 'Test' },
      timestamp: new Date().toISOString(),
    };
    const entities = defaultEntityExtractor(event);
    expect(entities).toHaveLength(2);
    expect(entities[0]).toEqual({
      entityType: 'device',
      entityId: 'AA:BB:CC:DD:EE:01',
      source: 'widget:entity-card',
    });
    expect(entities[1]).toEqual({
      entityType: 'zone',
      entityId: 'A',
      source: 'widget:entity-card',
    });
  });

  it('extracts devices from entity-list widget', () => {
    const event: WidgetRenderedEvent = {
      type: 'widget_rendered',
      widgetType: 'entity-list',
      data: {
        devices: [
          { mac: 'AA:BB:CC:DD:EE:01', name: 'd1' },
          { mac: 'AA:BB:CC:DD:EE:02', name: 'd2' },
        ],
      },
      timestamp: new Date().toISOString(),
    };
    const entities = defaultEntityExtractor(event);
    expect(entities).toHaveLength(2);
    expect(entities[0]).toMatchObject({ entityType: 'device', entityId: 'AA:BB:CC:DD:EE:01' });
    expect(entities[1]).toMatchObject({ entityType: 'device', entityId: 'AA:BB:CC:DD:EE:02' });
  });

  it('extracts zones and devices from scope-map widget', () => {
    const event: WidgetRenderedEvent = {
      type: 'widget_rendered',
      widgetType: 'scope-map',
      data: {
        highlight_zones: ['A', 'C'],
        highlight_devices: ['AA:BB:CC:DD:EE:01'],
      },
      timestamp: new Date().toISOString(),
    };
    const entities = defaultEntityExtractor(event);
    expect(entities).toHaveLength(3);
    expect(entities[0]).toMatchObject({ entityType: 'zone', entityId: 'A', source: 'widget:scope-map' });
    expect(entities[1]).toMatchObject({ entityType: 'zone', entityId: 'C', source: 'widget:scope-map' });
    expect(entities[2]).toMatchObject({ entityType: 'device', entityId: 'AA:BB:CC:DD:EE:01', source: 'widget:scope-map' });
  });

  it('extracts alert from alert-card widget using alert_id', () => {
    const event: WidgetRenderedEvent = {
      type: 'widget_rendered',
      widgetType: 'alert-card',
      data: { alert_id: 'alert-123', severity: 'high' },
      timestamp: new Date().toISOString(),
    };
    const entities = defaultEntityExtractor(event);
    expect(entities).toHaveLength(1);
    expect(entities[0]).toEqual({
      entityType: 'alert',
      entityId: 'alert-123',
      source: 'widget:alert-card',
    });
  });

  it('extracts alert from alert-card widget using id fallback', () => {
    const event: WidgetRenderedEvent = {
      type: 'widget_rendered',
      widgetType: 'alert-card',
      data: { id: 'alert-456', severity: 'low' },
      timestamp: new Date().toISOString(),
    };
    const entities = defaultEntityExtractor(event);
    expect(entities).toHaveLength(1);
    expect(entities[0]).toMatchObject({ entityType: 'alert', entityId: 'alert-456' });
  });

  it('extracts zone from tool parameters', () => {
    const event: ToolExecutedEvent = {
      type: 'tool_executed',
      toolName: 'shell_exec',
      toolId: 'tc-1',
      parameters: { zone: 'B', cmd: 'curl ...' },
      status: 'success',
      timestamp: new Date().toISOString(),
    };
    const entities = defaultEntityExtractor(event);
    expect(entities).toHaveLength(1);
    expect(entities[0]).toEqual({
      entityType: 'zone',
      entityId: 'B',
      source: 'tool:parameter',
    });
  });

  it('extracts device from tool parameters', () => {
    const event: ToolExecutedEvent = {
      type: 'tool_executed',
      toolName: 'shell_exec',
      toolId: 'tc-1',
      parameters: { mac: 'FF:FF:FF:FF:FF:FF' },
      status: 'success',
      timestamp: new Date().toISOString(),
    };
    const entities = defaultEntityExtractor(event);
    expect(entities).toHaveLength(1);
    expect(entities[0]).toMatchObject({ entityType: 'device', entityId: 'FF:FF:FF:FF:FF:FF' });
  });

  it('returns empty array for unknown widget type', () => {
    const event: WidgetRenderedEvent = {
      type: 'widget_rendered',
      widgetType: 'custom-unknown',
      data: { foo: 'bar' },
      timestamp: new Date().toISOString(),
    };
    expect(defaultEntityExtractor(event)).toEqual([]);
  });

  it('returns empty array for skill_activated events', () => {
    const event: SkillActivatedEvent = {
      type: 'skill_activated',
      skill: 'triage',
      timestamp: new Date().toISOString(),
    };
    expect(defaultEntityExtractor(event)).toEqual([]);
  });

  it('returns empty array for interaction events', () => {
    const event: EntityHoveredEvent = {
      type: 'entity_hovered',
      entity: { entityType: 'device', entityId: 'AA:BB', source: 'widget:entity-card' },
      timestamp: new Date().toISOString(),
    };
    expect(defaultEntityExtractor(event)).toEqual([]);
  });

  it('handles entity-list with non-object entries gracefully', () => {
    const event: WidgetRenderedEvent = {
      type: 'widget_rendered',
      widgetType: 'entity-list',
      data: { devices: ['not-an-object', null, 42] },
      timestamp: new Date().toISOString(),
    };
    expect(defaultEntityExtractor(event)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// WidgetEventBus
// ---------------------------------------------------------------------------

describe('WidgetEventBus', () => {
  let bus: WidgetEventBus;

  beforeEach(() => {
    bus = new WidgetEventBus();
  });

  it('emits typed events via processEvent', () => {
    const handler = vi.fn();
    bus.on('tool_executed', handler);

    const event: ToolExecutedEvent = {
      type: 'tool_executed',
      toolName: 'shell_exec',
      toolId: 'tc-1',
      parameters: {},
      status: 'success',
      timestamp: new Date().toISOString(),
    };
    bus.processEvent(event);

    expect(handler).toHaveBeenCalledWith(event);
  });

  it('emits wildcard events via processEvent', () => {
    const handler = vi.fn();
    bus.on('*', handler);

    const event: SkillActivatedEvent = {
      type: 'skill_activated',
      skill: 'triage',
      timestamp: new Date().toISOString(),
    };
    bus.processEvent(event);

    // First call is the event itself, subsequent calls may be entity_referenced
    expect(handler).toHaveBeenCalledWith(event);
  });

  it('runs entity extractors for agent-driven events', () => {
    const entityHandler = vi.fn();
    bus.on('entity_referenced', entityHandler);

    const event: WidgetRenderedEvent = {
      type: 'widget_rendered',
      widgetType: 'entity-card',
      data: { mac: 'AA:BB:CC:DD:EE:01', zone: 'A' },
      timestamp: new Date().toISOString(),
    };
    bus.processEvent(event);

    // Default extractor should find device + zone
    expect(entityHandler).toHaveBeenCalledTimes(2);
    expect(entityHandler).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'entity_referenced',
        entity: expect.objectContaining({ entityType: 'device', entityId: 'AA:BB:CC:DD:EE:01' }),
      }),
    );
    expect(entityHandler).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'entity_referenced',
        entity: expect.objectContaining({ entityType: 'zone', entityId: 'A' }),
      }),
    );
  });

  it('does NOT run entity extractors for interaction events', () => {
    const entityHandler = vi.fn();
    bus.on('entity_referenced', entityHandler);

    const event: EntityHoveredEvent = {
      type: 'entity_hovered',
      entity: { entityType: 'device', entityId: 'AA:BB', source: 'widget:entity-card' },
      timestamp: new Date().toISOString(),
    };
    bus.emitInteraction(event);

    expect(entityHandler).not.toHaveBeenCalled();
  });

  it('emits interaction events on typed channel and wildcard', () => {
    const typedHandler = vi.fn();
    const wildcardHandler = vi.fn();
    bus.on('entity_hovered', typedHandler);
    bus.on('*', wildcardHandler);

    const event: EntityHoveredEvent = {
      type: 'entity_hovered',
      entity: { entityType: 'device', entityId: 'AA:BB', source: 'test' },
      timestamp: new Date().toISOString(),
    };
    bus.emitInteraction(event);

    expect(typedHandler).toHaveBeenCalledWith(event);
    expect(wildcardHandler).toHaveBeenCalledWith(event);
  });

  it('emits entity_unhovered interaction events', () => {
    const handler = vi.fn();
    bus.on('entity_unhovered', handler);

    const event: EntityUnhoveredEvent = {
      type: 'entity_unhovered',
      entity: { entityType: 'zone', entityId: 'C', source: 'test' },
      timestamp: new Date().toISOString(),
    };
    bus.emitInteraction(event);

    expect(handler).toHaveBeenCalledWith(event);
  });

  it('emits entity_clicked interaction events', () => {
    const handler = vi.fn();
    bus.on('entity_clicked', handler);

    const event: EntityClickedEvent = {
      type: 'entity_clicked',
      entity: { entityType: 'alert', entityId: 'alert-1', source: 'test' },
      timestamp: new Date().toISOString(),
    };
    bus.emitInteraction(event);

    expect(handler).toHaveBeenCalledWith(event);
  });

  it('supports custom entity extractors via addExtractor', () => {
    const entityHandler = vi.fn();
    bus.on('entity_referenced', entityHandler);

    const customExtractor = vi.fn().mockReturnValue([
      { entityType: 'custom', entityId: 'c-1', source: 'custom-extractor' },
    ]);
    bus.addExtractor(customExtractor);

    const event: ToolExecutedEvent = {
      type: 'tool_executed',
      toolName: 'shell_exec',
      toolId: 'tc-1',
      parameters: {},
      status: 'success',
      timestamp: new Date().toISOString(),
    };
    bus.processEvent(event);

    // Default extractor returns nothing for empty params, custom returns 1
    expect(entityHandler).toHaveBeenCalledTimes(1);
    expect(entityHandler).toHaveBeenCalledWith(
      expect.objectContaining({
        entity: expect.objectContaining({ entityType: 'custom', entityId: 'c-1' }),
      }),
    );
  });

  it('replaces extractors with setExtractors', () => {
    const entityHandler = vi.fn();
    bus.on('entity_referenced', entityHandler);

    const customExtractor = vi.fn().mockReturnValue([]);
    bus.setExtractors([customExtractor]);

    const event: WidgetRenderedEvent = {
      type: 'widget_rendered',
      widgetType: 'entity-card',
      data: { mac: 'AA:BB:CC:DD:EE:01', zone: 'A' },
      timestamp: new Date().toISOString(),
    };
    bus.processEvent(event);

    // Custom extractor returns nothing — default was replaced
    expect(entityHandler).not.toHaveBeenCalled();
    expect(customExtractor).toHaveBeenCalledWith(event);
  });

  it('entity_referenced events also appear on wildcard', () => {
    const wildcardHandler = vi.fn();
    bus.on('*', wildcardHandler);

    const event: WidgetRenderedEvent = {
      type: 'widget_rendered',
      widgetType: 'entity-card',
      data: { mac: 'AA:BB:CC:DD:EE:01' },
      timestamp: new Date().toISOString(),
    };
    bus.processEvent(event);

    // Wildcard gets: widget_rendered + entity_referenced (device)
    expect(wildcardHandler).toHaveBeenCalledTimes(2);
    const calls = wildcardHandler.mock.calls.map((c: WidgetEvent[]) => c[0].type);
    expect(calls).toContain('widget_rendered');
    expect(calls).toContain('entity_referenced');
  });

  it('entity_referenced carries sourceEvent', () => {
    const entityHandler = vi.fn();
    bus.on('entity_referenced', entityHandler);

    const event: WidgetRenderedEvent = {
      type: 'widget_rendered',
      widgetType: 'entity-card',
      data: { mac: 'AA:BB:CC:DD:EE:01' },
      timestamp: new Date().toISOString(),
    };
    bus.processEvent(event);

    expect(entityHandler).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceEvent: event,
      }),
    );
  });

  it('removeAllListeners clears all subscriptions', () => {
    const handler = vi.fn();
    bus.on('tool_executed', handler);
    bus.on('*', handler);

    bus.removeAllListeners();

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

  it('does not run extractors for entity_referenced events (no infinite loop)', () => {
    const entityHandler = vi.fn();
    bus.on('entity_referenced', entityHandler);

    const refEvent: EntityReferencedEvent = {
      type: 'entity_referenced',
      entity: { entityType: 'device', entityId: 'AA:BB', source: 'test' },
      sourceEvent: {
        type: 'widget_rendered',
        widgetType: 'entity-card',
        data: { mac: 'AA:BB' },
        timestamp: new Date().toISOString(),
      },
      timestamp: new Date().toISOString(),
    };
    bus.processEvent(refEvent);

    // Should be emitted once (directly), not trigger extractors again
    expect(entityHandler).toHaveBeenCalledTimes(1);
    expect(entityHandler).toHaveBeenCalledWith(refEvent);
  });

  it('processes kb_proposal events and runs extractors', () => {
    const kbHandler = vi.fn();
    bus.on('kb_proposal', kbHandler);

    const event: KBProposalEvent = {
      type: 'kb_proposal',
      proposal: { scope: 'org', title: 'Test', reasoning: 'Reason' },
      timestamp: new Date().toISOString(),
    };
    bus.processEvent(event);

    expect(kbHandler).toHaveBeenCalledWith(event);
  });
});
