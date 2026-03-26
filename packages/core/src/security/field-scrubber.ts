/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import type {
  AccessConfig,
  FieldRestriction,
} from '../repo/connection-schemas.js';
import type {ScrubRecord, ScrubResult} from './security-types.js';
import type {ScrubTracker} from './scrub-tracker.js';

export interface FieldScrubberConfig {
  accessConfigs: Map<string, AccessConfig>;
  userRoles: string[];
  tracker: ScrubTracker;
}

/**
 * Intercepts API responses and strips restricted fields before
 * the data reaches the LLM context.
 */
export class FieldScrubber {
  private readonly accessConfigs: Map<string, AccessConfig>;
  private readonly userRoles: string[];
  private readonly tracker: ScrubTracker;

  constructor(config: FieldScrubberConfig) {
    this.accessConfigs = config.accessConfigs;
    this.userRoles = config.userRoles;
    this.tracker = config.tracker;
  }

  scrub(
    data: unknown,
    endpointPath: string,
    connectionName: string,
  ): ScrubResult {
    const accessConfig = this.accessConfigs.get(connectionName);
    if (!accessConfig) {
      return {data, records: [], strippedCount: 0, redactableCount: 0};
    }

    const endpoint = accessConfig['endpoints'][endpointPath];
    if (!endpoint) {
      return {data, records: [], strippedCount: 0, redactableCount: 0};
    }

    const entityTypes = new Set(endpoint.returns);
    const restrictions = (accessConfig.fieldRestrictions ?? []).filter((r) =>
      entityTypes.has(r.entity),
    );

    if (restrictions.length === 0) {
      return {data, records: [], strippedCount: 0, redactableCount: 0};
    }

    const restrictionsByEntity = new Map<string, FieldRestriction[]>();
    for (const r of restrictions) {
      const existing = restrictionsByEntity.get(r.entity) ?? [];
      existing.push(r);
      restrictionsByEntity.set(r.entity, existing);
    }

    const records: ScrubRecord[] = [];
    let strippedCount = 0;
    let redactableCount = 0;

    const scrubbed = this.walkAndScrub(
      data,
      restrictionsByEntity,
      connectionName,
      records,
    );

    for (const record of records) {
      if (record.policy === 'never_retrieve') {
        strippedCount++;
      } else if (record.policy === 'retrieve_but_redact') {
        redactableCount++;
      } else if (record.policy === 'role_gated') {
        if (!this.hasRole(this.findRestriction(restrictions, record))) {
          strippedCount++;
        } else {
          redactableCount++;
        }
      }
    }

    this.tracker.addRecords(records);

    return {data: scrubbed, records, strippedCount, redactableCount};
  }

  private findRestriction(
    restrictions: FieldRestriction[],
    record: ScrubRecord,
  ): FieldRestriction | undefined {
    return restrictions.find(
      (r) => r.entity === record.entity && r.field === record.field,
    );
  }

  private hasRole(restriction: FieldRestriction | undefined): boolean {
    if (!restriction) return false;
    const allowed = restriction.allowedRoles;
    if (!allowed || allowed.length === 0) return false;
    return this.userRoles.some((role) => allowed.includes(role));
  }

  private walkAndScrub(
    data: unknown,
    restrictionsByEntity: Map<string, FieldRestriction[]>,
    connectionName: string,
    records: ScrubRecord[],
    entityHint?: string,
  ): unknown {
    if (data === null || data === undefined) return data;

    if (Array.isArray(data)) {
      return data.map((item) =>
        this.walkAndScrub(
          item,
          restrictionsByEntity,
          connectionName,
          records,
          entityHint,
        ),
      );
    }

    if (typeof data === 'object') {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- SDK boundary: data is verified object
      const obj = data as Record<string, unknown>;
      const result: Record<string, unknown> = {};

      for (const key of Object.keys(obj)) {
        const value = obj[key];

        // Determine entity hint from key name
        const singularKey = depluralize(key);
        const childEntityHint = restrictionsByEntity.has(singularKey)
          ? singularKey
          : restrictionsByEntity.has(key)
            ? key
            : entityHint;

        // Check if this field is restricted for the current entity
        if (entityHint) {
          const entityRestrictions = restrictionsByEntity.get(entityHint);
          if (entityRestrictions) {
            const restriction = entityRestrictions.find(
              (r) => r.field === key,
            );
            if (restriction) {
              const strValue = String(value ?? '');
              const record: ScrubRecord = {
                value: strValue,
                entity: restriction.entity,
                field: restriction.field,
                sensitivity: restriction.sensitivity,
                policy: restriction.policy,
                connectionName,
                timestamp: Date.now(),
              };

              if (restriction.policy === 'never_retrieve') {
                records.push(record);
                continue; // strip field entirely
              } else if (restriction.policy === 'retrieve_but_redact') {
                records.push(record);
                result[key] = value; // keep for now, output guard redacts
              } else if (restriction.policy === 'role_gated') {
                if (this.hasRole(restriction)) {
                  records.push(record);
                  result[key] = value; // keep, redactable
                } else {
                  records.push(record);
                  continue; // strip — no role access
                }
              }
              continue;
            }
          }
        }

        // Recurse into nested objects/arrays
        if (typeof value === 'object' && value !== null) {
          result[key] = this.walkAndScrub(
            value,
            restrictionsByEntity,
            connectionName,
            records,
            Array.isArray(value) ? singularKey : childEntityHint,
          );
        } else {
          result[key] = value;
        }
      }

      return result;
    }

    return data;
  }
}

/**
 * Naive depluralize: strip trailing 's'.
 */
function depluralize(key: string): string {
  if (key.endsWith('s') && key.length > 1) {
    return key.slice(0, -1);
  }
  return key;
}
