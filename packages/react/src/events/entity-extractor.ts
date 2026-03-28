/**
 * @license
 * Copyright 2025 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import type { EntityReference, WidgetEvent } from './types';

/**
 * Default entity extractor. Inspects agent-driven events and extracts entity
 * references from known widget data shapes and tool parameters.
 */
export function defaultEntityExtractor(event: WidgetEvent): EntityReference[] {
  const entities: EntityReference[] = [];

  if (event.type === 'widget_rendered') {
    extractFromWidget(event.widgetType, event.data, entities);
  }

  if (event.type === 'tool_executed') {
    extractFromToolParams(event.parameters, entities);
  }

  return entities;
}

function extractFromWidget(
  widgetType: string,
  data: Record<string, unknown>,
  entities: EntityReference[],
): void {
  switch (widgetType) {
    case 'entity-card': {
      if (typeof data['mac'] === 'string') {
        entities.push({
          entityType: 'device',
          entityId: data['mac'],
          source: 'widget:entity-card',
        });
      }
      if (typeof data['zone'] === 'string') {
        entities.push({
          entityType: 'zone',
          entityId: data['zone'],
          source: 'widget:entity-card',
        });
      }
      break;
    }
    case 'entity-list': {
      const devices = data['devices'];
      if (Array.isArray(devices)) {
        for (const device of devices) {
          if (typeof device === 'object' && device !== null && 'mac' in device && typeof device['mac'] === 'string') {
            entities.push({
              entityType: 'device',
              entityId: device['mac'],
              source: 'widget:entity-list',
            });
          }
        }
      }
      break;
    }
    case 'scope-map': {
      const zones = data['highlight_zones'];
      if (Array.isArray(zones)) {
        for (const zone of zones) {
          if (typeof zone === 'string') {
            entities.push({
              entityType: 'zone',
              entityId: zone,
              source: 'widget:scope-map',
            });
          }
        }
      }
      const devices = data['highlight_devices'];
      if (Array.isArray(devices)) {
        for (const mac of devices) {
          if (typeof mac === 'string') {
            entities.push({
              entityType: 'device',
              entityId: mac,
              source: 'widget:scope-map',
            });
          }
        }
      }
      break;
    }
    case 'alert-card': {
      const alertId = data['alert_id'] ?? data['id'];
      if (typeof alertId === 'string') {
        entities.push({
          entityType: 'alert',
          entityId: alertId,
          source: 'widget:alert-card',
        });
      }
      break;
    }
    default:
      break;
  }
}

function extractFromToolParams(
  parameters: Record<string, unknown>,
  entities: EntityReference[],
): void {
  if (typeof parameters['zone'] === 'string') {
    entities.push({
      entityType: 'zone',
      entityId: parameters['zone'],
      source: 'tool:parameter',
    });
  }
  if (typeof parameters['mac'] === 'string') {
    entities.push({
      entityType: 'device',
      entityId: parameters['mac'],
      source: 'tool:parameter',
    });
  }
}
