/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import {describe, it, expect, afterEach} from 'vitest';
import {resolveEnvRef} from './env-ref.js';

describe('resolveEnvRef', () => {
  const envKeys: string[] = [];
  afterEach(() => {
    for (const k of envKeys) delete process.env[k];
    envKeys.length = 0;
  });

  it('returns undefined for undefined input', () => {
    expect(resolveEnvRef(undefined)).toBeUndefined();
  });

  it('returns undefined for empty string', () => {
    expect(resolveEnvRef('')).toBeUndefined();
  });

  it('returns the input unchanged when not an env: ref', () => {
    expect(resolveEnvRef('postgres://user:pass@host/db')).toBe(
      'postgres://user:pass@host/db',
    );
  });

  it('resolves env:VAR to the variable value', () => {
    process.env['RESOLVE_TEST_VAR'] = 'resolved-value';
    envKeys.push('RESOLVE_TEST_VAR');
    expect(resolveEnvRef('env:RESOLVE_TEST_VAR')).toBe('resolved-value');
  });

  it('returns undefined when env:VAR references an unset variable', () => {
    delete process.env['DEFINITELY_UNSET_VAR_XYZ'];
    expect(resolveEnvRef('env:DEFINITELY_UNSET_VAR_XYZ')).toBeUndefined();
  });
});
