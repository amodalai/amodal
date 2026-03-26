/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import { describe, it, expect } from 'vitest';
import {
  RoleDefinitionSchema,
  AutomationPermissionsSchema,
  ROLE_WILDCARD,
} from './role-types.js';

describe('AutomationPermissionsSchema', () => {
  it('should apply defaults when empty object provided', () => {
    const result = AutomationPermissionsSchema.parse({});
    expect(result).toEqual({ can_view: true, can_create: false });
  });

  it('should accept explicit values', () => {
    const result = AutomationPermissionsSchema.parse({
      can_view: false,
      can_create: true,
    });
    expect(result).toEqual({ can_view: false, can_create: true });
  });

  it('should reject non-boolean values', () => {
    expect(() =>
      AutomationPermissionsSchema.parse({ can_view: 'yes' }),
    ).toThrow();
  });
});

describe('RoleDefinitionSchema', () => {
  it('should parse a valid role with all fields', () => {
    const input = {
      name: 'analyst',
      tools: ['query_devices', 'get_device_detail'],
      skills: ['triage', 'investigation'],
      automations: { can_view: true, can_create: false },
      constraints: { max_window_hours: 24 },
    };
    const result = RoleDefinitionSchema.parse(input);
    expect(result.name).toBe('analyst');
    expect(result.tools).toEqual(['query_devices', 'get_device_detail']);
    expect(result.skills).toEqual(['triage', 'investigation']);
    expect(result.automations).toEqual({ can_view: true, can_create: false });
    expect(result.constraints).toEqual({ max_window_hours: 24 });
  });

  it('should apply defaults for optional fields', () => {
    const result = RoleDefinitionSchema.parse({
      name: 'viewer',
      tools: ['read_only'],
    });
    expect(result.skills).toEqual(['*']);
    expect(result.automations).toEqual({ can_view: true, can_create: false });
    expect(result.constraints).toEqual({});
  });

  it('should accept wildcard "*" in tools list', () => {
    const result = RoleDefinitionSchema.parse({
      name: 'supervisor',
      tools: ['*'],
    });
    expect(result.tools).toEqual(['*']);
  });

  it('should accept wildcard "*" in skills list', () => {
    const result = RoleDefinitionSchema.parse({
      name: 'admin',
      tools: ['*'],
      skills: ['*'],
    });
    expect(result.skills).toEqual(['*']);
  });

  it('should reject empty name', () => {
    expect(() =>
      RoleDefinitionSchema.parse({ name: '', tools: ['a'] }),
    ).toThrow();
  });

  it('should reject empty tools array', () => {
    expect(() =>
      RoleDefinitionSchema.parse({ name: 'empty', tools: [] }),
    ).toThrow();
  });

  it('should reject missing name', () => {
    expect(() => RoleDefinitionSchema.parse({ tools: ['a'] })).toThrow();
  });

  it('should reject missing tools', () => {
    expect(() => RoleDefinitionSchema.parse({ name: 'no-tools' })).toThrow();
  });

  it('should reject empty string in tools array', () => {
    expect(() =>
      RoleDefinitionSchema.parse({ name: 'bad', tools: [''] }),
    ).toThrow();
  });

  it('should reject non-object constraints', () => {
    expect(() =>
      RoleDefinitionSchema.parse({
        name: 'bad',
        tools: ['a'],
        constraints: 'string',
      }),
    ).toThrow();
  });

  it('should allow multiple tools in the list', () => {
    const result = RoleDefinitionSchema.parse({
      name: 'multi',
      tools: ['tool_a', 'tool_b', 'tool_c'],
    });
    expect(result.tools).toHaveLength(3);
  });

  it('should allow mixed tool names and wildcard', () => {
    const result = RoleDefinitionSchema.parse({
      name: 'mixed',
      tools: ['*', 'extra_tool'],
    });
    expect(result.tools).toContain('*');
    expect(result.tools).toContain('extra_tool');
  });
});

describe('ROLE_WILDCARD', () => {
  it('should be "*"', () => {
    expect(ROLE_WILDCARD).toBe('*');
  });
});
