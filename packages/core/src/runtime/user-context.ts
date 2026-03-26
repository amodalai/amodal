/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import type {LoadedConnection} from '../repo/connection-types.js';
import type {ScopingRule} from '../repo/connection-schemas.js';

/**
 * The result of processing a user context response.
 */
export interface UserContextResult {
  raw: Record<string, unknown>;
  roles: string[];
  scopeLabels: Record<string, string>;
  scopeRules: Record<string, ScopingRule>;
  fieldGuidance: string;
  alternativeLookupGuidance: string;
}

/**
 * Extract roles from a user context response object.
 * Looks for: role (string), roles (string[]), permissions.role, user.role.
 */
export function extractRoles(data: Record<string, unknown>): string[] {
  // Direct role string
  if (typeof data['role'] === 'string') {
    return [data['role']];
  }

  // Direct roles array
  if (Array.isArray(data['roles'])) {
    return data['roles'].filter((r): r is string => typeof r === 'string');
  }

  // Nested permissions.role
  const permissions = data['permissions'];
  if (permissions !== null && typeof permissions === 'object' && !Array.isArray(permissions)) {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- SDK boundary: verified object
    const perms = permissions as Record<string, unknown>;
    if (typeof perms['role'] === 'string') {
      return [perms['role']];
    }
  }

  // Nested user.role
  const user = data['user'];
  if (user !== null && typeof user === 'object' && !Array.isArray(user)) {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- SDK boundary: verified object
    const usr = user as Record<string, unknown>;
    if (typeof usr['role'] === 'string') {
      return [usr['role']];
    }
  }

  return [];
}

/**
 * Resolve scope labels for a user's roles from all connections' rowScoping.
 *
 * For each entity in each connection's rowScoping, finds the first matching
 * role's scoping rule label. If no role matches, the entity is skipped.
 */
export function resolveScopeLabels(
  connections: Map<string, LoadedConnection>,
  userRoles: string[],
): {scopeLabels: Record<string, string>; scopeRules: Record<string, ScopingRule>} {
  const scopeLabels: Record<string, string> = {};
  const scopeRules: Record<string, ScopingRule> = {};

  for (const [, conn] of connections) {
    const rowScoping = conn.access.rowScoping;
    if (!rowScoping) continue;

    for (const [entity, roleMap] of Object.entries(rowScoping)) {
      // Already resolved this entity from a prior connection
      if (scopeRules[entity]) continue;

      // Try to find a matching role
      let matched = false;
      for (const role of userRoles) {
        const rule = roleMap[role];
        if (rule) {
          scopeRules[entity] = rule;
          scopeLabels[entity] = rule.label ?? `scoped by ${rule.type}`;
          matched = true;
          break;
        }
      }

      // If no role matched, skip this entity
      if (!matched) continue;
    }
  }

  return {scopeLabels, scopeRules};
}

/**
 * Generate field guidance text from all connections' fieldRestrictions.
 *
 * Lists never_retrieve fields as "Do not request: entity.field (reason)"
 * Lists role_gated fields with allowed roles
 * Lists retrieve_but_redact fields as "Will be redacted: entity.field"
 */
export function generateFieldGuidance(
  connections: Map<string, LoadedConnection>,
  userRoles: string[],
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
        const allowed = r.allowedRoles ?? [];
        const hasAccess = userRoles.some((role) => allowed.includes(role));
        if (!hasAccess) {
          lines.push(
            `Do not request: ${r.entity}.${r.field} (requires role: ${allowed.join(', ')})`,
          );
        }
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
    roles: [],
    scopeLabels: {},
    scopeRules: {},
    fieldGuidance: '',
    alternativeLookupGuidance: '',
  };
}
