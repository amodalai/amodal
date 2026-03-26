/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import { describe, it, expect } from 'vitest';
import {
  isToolAllowedByRole,
  isSkillAllowedByRole,
  resolveActiveRole,
} from './role-filter.js';
import type { RoleDefinition } from './role-types.js';

function makeRole(overrides: Partial<RoleDefinition> = {}): RoleDefinition {
  return {
    name: 'test-role',
    tools: ['tool_a', 'tool_b'],
    skills: ['*'],
    automations: { can_view: true, can_create: false },
    constraints: {},
    ...overrides,
  };
}

describe('isToolAllowedByRole', () => {
  it('should allow all tools when no role is set', () => {
    expect(isToolAllowedByRole('any_tool', undefined)).toBe(true);
  });

  it('should allow all tools when role has wildcard', () => {
    const role = makeRole({ tools: ['*'] });
    expect(isToolAllowedByRole('any_tool', role)).toBe(true);
    expect(isToolAllowedByRole('another_tool', role)).toBe(true);
  });

  it('should allow tools in the role list', () => {
    const role = makeRole({ tools: ['tool_a', 'tool_b'] });
    expect(isToolAllowedByRole('tool_a', role)).toBe(true);
    expect(isToolAllowedByRole('tool_b', role)).toBe(true);
  });

  it('should deny tools not in the role list', () => {
    const role = makeRole({ tools: ['tool_a', 'tool_b'] });
    expect(isToolAllowedByRole('tool_c', role)).toBe(false);
  });

  it('should be case-sensitive', () => {
    const role = makeRole({ tools: ['Tool_A'] });
    expect(isToolAllowedByRole('tool_a', role)).toBe(false);
    expect(isToolAllowedByRole('Tool_A', role)).toBe(true);
  });

  it('should handle single-tool role', () => {
    const role = makeRole({ tools: ['only_tool'] });
    expect(isToolAllowedByRole('only_tool', role)).toBe(true);
    expect(isToolAllowedByRole('other', role)).toBe(false);
  });

  it('should handle wildcard mixed with other tools', () => {
    const role = makeRole({ tools: ['*', 'specific_tool'] });
    expect(isToolAllowedByRole('any_tool', role)).toBe(true);
  });
});

describe('isSkillAllowedByRole', () => {
  it('should allow all skills when no role is set', () => {
    expect(isSkillAllowedByRole('any_skill', undefined)).toBe(true);
  });

  it('should allow all skills when role has wildcard (default)', () => {
    const role = makeRole(); // skills defaults to ["*"]
    expect(isSkillAllowedByRole('any_skill', role)).toBe(true);
  });

  it('should allow skills in the role list', () => {
    const role = makeRole({ skills: ['triage', 'investigation'] });
    expect(isSkillAllowedByRole('triage', role)).toBe(true);
    expect(isSkillAllowedByRole('investigation', role)).toBe(true);
  });

  it('should deny skills not in the role list', () => {
    const role = makeRole({ skills: ['triage'] });
    expect(isSkillAllowedByRole('investigation', role)).toBe(false);
  });

  it('should be case-sensitive', () => {
    const role = makeRole({ skills: ['Triage'] });
    expect(isSkillAllowedByRole('triage', role)).toBe(false);
    expect(isSkillAllowedByRole('Triage', role)).toBe(true);
  });

  it('should handle single-skill role', () => {
    const role = makeRole({ skills: ['only_skill'] });
    expect(isSkillAllowedByRole('only_skill', role)).toBe(true);
    expect(isSkillAllowedByRole('other', role)).toBe(false);
  });
});

describe('resolveActiveRole', () => {
  const definitions: RoleDefinition[] = [
    makeRole({ name: 'analyst', tools: ['query_devices'] }),
    makeRole({ name: 'supervisor', tools: ['*'] }),
  ];

  it('should return undefined when roleName is undefined', () => {
    expect(resolveActiveRole(undefined, definitions)).toBeUndefined();
  });

  it('should return the matching role definition', () => {
    const role = resolveActiveRole('analyst', definitions);
    expect(role).toBeDefined();
    expect(role!.name).toBe('analyst');
    expect(role!.tools).toEqual(['query_devices']);
  });

  it('should return the correct role when multiple exist', () => {
    const role = resolveActiveRole('supervisor', definitions);
    expect(role).toBeDefined();
    expect(role!.name).toBe('supervisor');
    expect(role!.tools).toEqual(['*']);
  });

  it('should throw for unknown role name', () => {
    expect(() => resolveActiveRole('unknown', definitions)).toThrow(
      'Unknown role "unknown"',
    );
  });

  it('should include available roles in error message', () => {
    expect(() => resolveActiveRole('missing', definitions)).toThrow(
      'Available roles: analyst, supervisor',
    );
  });

  it('should throw with "(none)" when no definitions exist', () => {
    expect(() => resolveActiveRole('any', [])).toThrow(
      'Available roles: (none)',
    );
  });

  it('should return undefined for empty string roleName', () => {
    // Empty string is falsy, treated as "no role"
    expect(resolveActiveRole('', definitions)).toBeUndefined();
  });
});
