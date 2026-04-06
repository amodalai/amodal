/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import type {LoadedConnection} from '../repo/connection-types.js';

/**
 * The result of processing a user context response.
 */
export interface UserContextResult {
  raw: Record<string, unknown>;
  fieldGuidance: string;
  alternativeLookupGuidance: string;
}

/**
 * Generate field guidance text from all connections' fieldRestrictions.
 *
 * Lists never_retrieve fields as "Do not request: entity.field (reason)"
 * Lists role_gated fields as "Do not request: entity.field" (no role system, always denied)
 * Lists retrieve_but_redact fields as "Will be redacted: entity.field"
 */
export function generateFieldGuidance(
  connections: Map<string, LoadedConnection>,
): string {
  const lines: string[] = [];

  for (const [, conn] of connections) {
    const restrictions = conn.access.fieldRestrictions;
    if (!restrictions || restrictions.length === 0) continue;

    for (const r of restrictions) {
      if (r.policy === 'never_retrieve') {
        const reason = r.reason ? ` (${r.reason})` : '';
        lines.push(`Do not request: ${r.entity}.${r.field}${reason}`);
      } else if (r.policy === 'role_gated') {
        // No role system in OSS runtime — role_gated fields are always denied
        lines.push(`Do not request: ${r.entity}.${r.field}`);
      } else if (r.policy === 'retrieve_but_redact') {
        lines.push(`Will be redacted: ${r.entity}.${r.field}`);
      }
    }
  }

  return lines.join('\n');
}

/**
 * Generate alternative lookup guidance from all connections' alternativeLookups.
 */
export function generateAlternativeLookupGuidance(
  connections: Map<string, LoadedConnection>,
): string {
  const lines: string[] = [];

  for (const [, conn] of connections) {
    const lookups = conn.access.alternativeLookups;
    if (!lookups || lookups.length === 0) continue;

    for (const lookup of lookups) {
      const desc = lookup.description ? ` — ${lookup.description}` : '';
      lines.push(
        `Instead of ${lookup.restrictedField}, use ${lookup.alternativeEndpoint}${desc}`,
      );
    }
  }

  return lines.join('\n');
}

/**
 * Create a default empty UserContextResult.
 */
export function defaultUserContext(): UserContextResult {
  return {
    raw: {},
    fieldGuidance: '',
    alternativeLookupGuidance: '',
  };
}
