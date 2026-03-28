/**
 * @license
 * Copyright 2025 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import { TypedEventEmitter } from '../client/EventEmitter';
import { defaultEntityExtractor } from './entity-extractor';
import type { WidgetEventMap, WidgetEvent, EntityExtractor, EntityReferencedEvent } from './types';

/**
 * Event bus for widget events. Emits both agent-driven events (from SSE stream)
 * and user interaction events (hover/click on entities in the chat).
 *
 * Subscribing to `'*'` receives all events.
 */
export class WidgetEventBus extends TypedEventEmitter<WidgetEventMap> {
  private extractors: EntityExtractor[] = [defaultEntityExtractor];

  /**
   * Process an agent-driven event: emit on its typed channel + '*',
   * then run entity extractors and emit entity_referenced for each found entity.
   */
  processEvent(event: WidgetEvent): void {
    // Emit on the typed channel
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- event type matches map key
    this.emit(event.type as keyof WidgetEventMap, event as never);
    this.emit('*', event);

    // Run entity extractors only for agent-driven events (not interaction events, not entity_referenced)
    if (
      event.type === 'tool_executed' ||
      event.type === 'skill_activated' ||
      event.type === 'widget_rendered' ||
      event.type === 'kb_proposal'
    ) {
      for (const extractor of this.extractors) {
        const entities = extractor(event);
        for (const entity of entities) {
          const refEvent: EntityReferencedEvent = {
            type: 'entity_referenced',
            entity,
            sourceEvent: event,
            timestamp: new Date().toISOString(),
          };
          this.emit('entity_referenced', refEvent);
          this.emit('*', refEvent);
        }
      }
    }
  }

  /**
   * Emit an interaction event (entity_hovered, entity_unhovered, entity_clicked).
   * These are emitted on their typed channel + '*' without running extractors,
   * since interaction events already carry their EntityReference.
   */
  emitInteraction(event: WidgetEvent): void {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- event type matches map key
    this.emit(event.type as keyof WidgetEventMap, event as never);
    this.emit('*', event);
  }

  /** Add a custom entity extractor. */
  addExtractor(fn: EntityExtractor): void {
    this.extractors.push(fn);
  }

  /** Replace all entity extractors (including the default). */
  setExtractors(fns: EntityExtractor[]): void {
    this.extractors = [...fns];
  }
}
