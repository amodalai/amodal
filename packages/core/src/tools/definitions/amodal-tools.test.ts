/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import { describe, it, expect } from 'vitest';
import {
  getProposeKnowledgeDefinition,
  getProposeKnowledgeDefinition,
  getPresentToolDefinition,
  getRequestToolDefinition,
} from './amodal-tools.js';

describe('amodal-tools definitions', () => {
  it('should return propose_knowledge definition', () => {
    const def = getProposeKnowledgeDefinition();
    expect(def.base.name).toBe('propose_knowledge');
    expect(def.base.description).toBeDefined();
    expect(def.base.parametersJsonSchema).toBeDefined();
     
    const required = (def.base.parametersJsonSchema as Record<string, unknown>)['required'] as string[];
    expect(required).toContain('action');
    expect(required).toContain('scope');
    expect(required).toContain('title');
  });

  it('should have backward-compatible alias', () => {
    const def1 = getProposeKnowledgeDefinition();
    const def2 = getProposeKnowledgeDefinition();
    expect(def1.base.name).toBe(def2.base.name);
  });

  it('should return present tool definition', () => {
    const def = getPresentToolDefinition();
    expect(def.base.name).toBe('present');
    expect(def.base.description).toBeDefined();
  });

  it('should return request tool definition', () => {
    const def = getRequestToolDefinition();
    expect(def.base.name).toBe('request');
    expect(def.base.description).toBeDefined();
     
    const required = (def.base.parametersJsonSchema as Record<string, unknown>)['required'] as string[];
    expect(required).toContain('connection');
    expect(required).toContain('method');
    expect(required).toContain('endpoint');
    expect(required).toContain('intent');
  });
});
