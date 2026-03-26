/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import { type RoleDefinition, ROLE_WILDCARD } from './role-types.js';

/**
 * Checks whether a tool is allowed by the active role.
 *
 * Returns true (allowed) if:
 * - No role is set (backward-compatible: all tools available)
 * - The role's tools list contains the wildcard "*"
 * - The role's tools list contains the tool name
 */
export function isToolAllowedByRole(
  toolName: string,
  role: RoleDefinition | undefined,
): boolean {
  if (!role) return true;
  if (role.tools.includes(ROLE_WILDCARD)) return true;
  return role.tools.includes(toolName);
}

/**
 * Checks whether a skill is allowed by the active role.
 *
 * Returns true (allowed) if:
 * - No role is set (backward-compatible: all skills available)
 * - The role's skills list contains the wildcard "*"
 * - The role's skills list contains the skill name
 */
export function isSkillAllowedByRole(
  skillName: string,
  role: RoleDefinition | undefined,
): boolean {
  if (!role) return true;
  if (role.skills.includes(ROLE_WILDCARD)) return true;
  return role.skills.includes(skillName);
}

/**
 * Resolves the active role definition by name from a list of definitions.
 *
 * @param roleName - The name of the role to resolve (undefined = no role)
 * @param definitions - Available role definitions
 * @returns The matching RoleDefinition, or undefined if no role name given
 * @throws Error if roleName is provided but not found in definitions
 */
export function resolveActiveRole(
  roleName: string | undefined,
  definitions: RoleDefinition[],
): RoleDefinition | undefined {
  if (!roleName) return undefined;
  const role = definitions.find((d) => d.name === roleName);
  if (!role) {
    const available = definitions.map((d) => d.name).join(', ');
    throw new Error(
      `Unknown role "${roleName}". Available roles: ${available || '(none)'}`,
    );
  }
  return role;
}
