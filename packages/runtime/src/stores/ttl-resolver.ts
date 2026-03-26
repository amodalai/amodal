/**
 * @license
 * Copyright 2025 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import type {StoreTtlConfig} from '@amodalai/core';

/**
 * Evaluate a simple TTL condition against a document payload.
 *
 * Supported condition syntax:
 *   field IN ['val1', 'val2']
 *   field = 'value'
 *   field != 'value'
 */
export function evaluateCondition(
  condition: string,
  payload: Record<string, unknown>,
): boolean {
  // Match: field IN ['val1', 'val2', ...]
  const inMatch = condition.match(/^(\w+)\s+IN\s+\[([^\]]+)\]$/i);
  if (inMatch) {
    const field = inMatch[1];
    const valuesStr = inMatch[2];
    const values = valuesStr
      .split(',')
      .map((v) => v.trim().replace(/^['"]|['"]$/g, ''));
    return values.includes(String(payload[field] ?? ''));
  }

  // Match: field = 'value'
  const eqMatch = condition.match(/^(\w+)\s*=\s*['"]([^'"]*)['"]\s*$/);
  if (eqMatch) {
    return String(payload[eqMatch[1]] ?? '') === eqMatch[2];
  }

  // Match: field != 'value'
  const neqMatch = condition.match(/^(\w+)\s*!=\s*['"]([^'"]*)['"]\s*$/);
  if (neqMatch) {
    return String(payload[neqMatch[1]] ?? '') !== neqMatch[2];
  }

  // Unknown condition — don't apply override
  return false;
}

/**
 * Resolve the effective TTL for a document given the store's TTL config
 * and the document payload.
 *
 * Returns undefined if no TTL is configured (document never expires).
 * For conditional TTL, checks overrides in order and returns the first match,
 * falling back to the default.
 */
export function resolveTtl(
  ttlConfig: StoreTtlConfig | undefined,
  payload: Record<string, unknown>,
): number | undefined {
  if (ttlConfig === undefined) {
    return undefined;
  }

  // Simple number TTL
  if (typeof ttlConfig === 'number') {
    return ttlConfig;
  }

  // Conditional TTL — check overrides first
  if (ttlConfig.override) {
    for (const override of ttlConfig.override) {
      if (evaluateCondition(override.condition, payload)) {
        return override.ttl;
      }
    }
  }

  return ttlConfig.default;
}
