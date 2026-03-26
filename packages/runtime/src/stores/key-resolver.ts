/**
 * @license
 * Copyright 2025 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

/**
 * Resolve a key template against a payload.
 *
 * Templates use `{fieldName}` placeholders that are replaced with values
 * from the payload. If the template is just `{fieldName}`, the value is
 * used directly. If it contains a prefix (e.g., `alert:{event_id}`),
 * the resolved value is interpolated into the string.
 *
 * @example
 * resolveKey('{event_id}', { event_id: 'evt_123' })
 * // => 'evt_123'
 *
 * resolveKey('alert:{event_id}', { event_id: 'evt_123' })
 * // => 'alert:evt_123'
 */
export function resolveKey(
  template: string,
  payload: Record<string, unknown>,
): string {
  return template.replace(/\{(\w+)\}/g, (_match, field: string) => {
    const value = payload[field];
    if (value === undefined || value === null) {
      throw new Error(`Key template references field "${field}" but it is missing from the payload`);
    }
    return String(value);
  });
}
