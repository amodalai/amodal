/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import {describe, it, expect} from 'vitest';
import {detectDrift} from './drift-detector.js';
import type {ParsedEndpoint} from './openapi-parser.js';
import type {SurfaceEndpoint} from './connection-types.js';

function specEp(method: string, path: string, opts?: Partial<ParsedEndpoint>): ParsedEndpoint {
  return {method, path, tags: [], parameters: [], deprecated: false, ...opts};
}

function surfaceEp(method: string, path: string, opts?: Partial<SurfaceEndpoint>): SurfaceEndpoint {
  return {method, path, description: '', included: true, ...opts};
}

describe('detectDrift', () => {
  it('should return all unchanged when spec matches surface', () => {
    const spec = [specEp('GET', '/users'), specEp('POST', '/users')];
    const surface = [surfaceEp('GET', '/users'), surfaceEp('POST', '/users')];

    const result = detectDrift(spec, surface);
    expect(result.added).toHaveLength(0);
    expect(result.removed).toHaveLength(0);
    expect(result.changed).toHaveLength(0);
    expect(result.unchanged).toHaveLength(2);
  });

  it('should detect added endpoints', () => {
    const spec = [specEp('GET', '/users'), specEp('GET', '/orders')];
    const surface = [surfaceEp('GET', '/users')];

    const result = detectDrift(spec, surface);
    expect(result.added).toHaveLength(1);
    expect(result.added[0]?.path).toBe('/orders');
  });

  it('should detect removed endpoints', () => {
    const spec = [specEp('GET', '/users')];
    const surface = [surfaceEp('GET', '/users'), surfaceEp('GET', '/legacy')];

    const result = detectDrift(spec, surface);
    expect(result.removed).toHaveLength(1);
    expect(result.removed[0]?.path).toBe('/legacy');
  });

  it('should detect deprecated endpoints as changed', () => {
    const spec = [specEp('GET', '/users', {deprecated: true})];
    const surface = [surfaceEp('GET', '/users')];

    const result = detectDrift(spec, surface);
    expect(result.changed).toHaveLength(1);
    expect(result.changed[0]?.changes).toContain('deprecated in spec');
  });

  it('should detect description changes', () => {
    const spec = [specEp('GET', '/users', {summary: 'Get all users v2'})];
    const surface = [surfaceEp('GET', '/users', {description: 'Get all users'})];

    const result = detectDrift(spec, surface);
    expect(result.changed).toHaveLength(1);
    expect(result.changed[0]?.changes).toContain('description updated');
  });

  it('should handle empty spec', () => {
    const surface = [surfaceEp('GET', '/users')];

    const result = detectDrift([], surface);
    expect(result.removed).toHaveLength(1);
    expect(result.unchanged).toHaveLength(0);
  });

  it('should handle empty surface', () => {
    const spec = [specEp('GET', '/users')];

    const result = detectDrift(spec, []);
    expect(result.added).toHaveLength(1);
    expect(result.unchanged).toHaveLength(0);
  });

  it('should handle both empty', () => {
    const result = detectDrift([], []);
    expect(result.added).toHaveLength(0);
    expect(result.removed).toHaveLength(0);
    expect(result.changed).toHaveLength(0);
    expect(result.unchanged).toHaveLength(0);
  });

  it('should match methods case-insensitively', () => {
    const spec = [specEp('GET', '/users')];
    const surface = [surfaceEp('GET', '/users')];

    const result = detectDrift(spec, surface);
    expect(result.unchanged).toHaveLength(1);
  });

  it('should handle complex scenario with mixed changes', () => {
    const spec = [
      specEp('GET', '/users'),
      specEp('POST', '/users'),
      specEp('GET', '/orders'),
      specEp('DELETE', '/old', {deprecated: true}),
    ];
    const surface = [
      surfaceEp('GET', '/users'),
      surfaceEp('POST', '/users'),
      surfaceEp('GET', '/legacy'),
      surfaceEp('DELETE', '/old'),
    ];

    const result = detectDrift(spec, surface);
    expect(result.added).toHaveLength(1); // /orders
    expect(result.removed).toHaveLength(1); // /legacy
    expect(result.changed).toHaveLength(1); // /old deprecated
    expect(result.unchanged).toHaveLength(2); // /users GET, POST
  });
});
