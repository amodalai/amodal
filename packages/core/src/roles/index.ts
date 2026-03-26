/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

export {
  RoleDefinitionSchema,
  AutomationPermissionsSchema,
  ROLE_WILDCARD,
  type RoleDefinition,
  type AutomationPermissions,
} from './role-types.js';

export {
  isToolAllowedByRole,
  isSkillAllowedByRole,
  resolveActiveRole,
} from './role-filter.js';
