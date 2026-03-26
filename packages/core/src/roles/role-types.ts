/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import { z } from 'zod';

/**
 * Schema for automation permissions within a role.
 */
export const AutomationPermissionsSchema = z.object({
  /** Whether the role can view automation results */
  can_view: z.boolean().default(true),
  /** Whether the role can create new automations */
  can_create: z.boolean().default(false),
});

/**
 * Schema for a single role definition.
 *
 * A role determines which tools and skills a user can access.
 * Tools requires at least one entry; use "*" for wildcard (allow all).
 * Skills defaults to ["*"] (allow all) if not specified.
 * Constraints is a generic record for domain-specific validation.
 */
export const RoleDefinitionSchema = z.object({
  /** Unique role name */
  name: z.string().min(1),
  /** Allowed tool names — at least one required, "*" = wildcard */
  tools: z.array(z.string().min(1)).min(1),
  /** Allowed skill names — defaults to ["*"] (all) */
  skills: z.array(z.string().min(1)).default(['*']),
  /** Automation permissions */
  automations: AutomationPermissionsSchema.default({}),
  /** Domain-specific constraints (validated by business logic, not schema) */
  constraints: z.record(z.unknown()).default({}),
});

/** Inferred type for a role definition */
export type RoleDefinition = z.infer<typeof RoleDefinitionSchema>;

/** Inferred type for automation permissions */
export type AutomationPermissions = z.infer<typeof AutomationPermissionsSchema>;

/** Wildcard value that means "allow all" */
export const ROLE_WILDCARD = '*';
