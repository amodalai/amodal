/**
 * @license
 * Copyright 2025 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import {describe, it, expect} from 'vitest';
import {resolveKey} from './key-resolver.js';

describe('resolveKey', () => {
  it('resolves a simple field reference', () => {
    expect(resolveKey('{event_id}', {event_id: 'evt_123'})).toBe('evt_123');
  });

  it('resolves a prefixed key template', () => {
    expect(resolveKey('alert:{event_id}', {event_id: 'evt_123'})).toBe('alert:evt_123');
  });

  it('resolves multiple fields', () => {
    expect(resolveKey('{tenant}:{id}', {tenant: 'acme', id: '42'})).toBe('acme:42');
  });

  it('converts numeric values to string', () => {
    expect(resolveKey('{id}', {id: 42})).toBe('42');
  });

  it('throws on missing field', () => {
    expect(() => resolveKey('{missing}', {other: 'val'})).toThrow('missing from the payload');
  });

  it('throws on null field', () => {
    expect(() => resolveKey('{field}', {field: null})).toThrow('missing from the payload');
  });

  it('returns template as-is when no placeholders', () => {
    expect(resolveKey('static-key', {anything: true})).toBe('static-key');
  });
});
