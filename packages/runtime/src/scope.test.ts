/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import {describe, it, expect} from 'vitest';
import {resolveScope} from './scope.js';
import type {AuthContext} from './middleware/auth.js';

function makeAuth(overrides: Partial<AuthContext> = {}): AuthContext {
  return {
    applicationId: 'app-1',
    authMethod: 'api-key',
    ...overrides,
  };
}

describe('resolveScope', () => {
  it('returns scopeId from auth context when present', () => {
    const auth = makeAuth({scopeId: 'user-42'});
    const result = resolveScope({}, auth);
    expect(result.scopeId).toBe('user-42');
  });

  it('returns scopeId from request body when auth has none', () => {
    const auth = makeAuth();
    const result = resolveScope({scope_id: 'body-scope'}, auth);
    expect(result.scopeId).toBe('body-scope');
  });

  it('auth scopeId takes precedence over request body scopeId', () => {
    const auth = makeAuth({scopeId: 'auth-scope'});
    const result = resolveScope({scope_id: 'body-scope'}, auth);
    expect(result.scopeId).toBe('auth-scope');
  });

  it('defaults to empty string when neither auth nor body has scopeId', () => {
    const auth = makeAuth();
    const result = resolveScope({}, auth);
    expect(result.scopeId).toBe('');
  });

  it('defaults to empty string when no auth and no body scopeId', () => {
    const result = resolveScope({});
    expect(result.scopeId).toBe('');
  });

  it('returns scopeContext from auth when present', () => {
    const ctx = {plan: 'pro', region: 'us-west'};
    const auth = makeAuth({scopeId: 'u1', scopeContext: ctx});
    const result = resolveScope({}, auth);
    expect(result.scopeContext).toEqual(ctx);
  });

  it('falls back to context from request body when auth has none', () => {
    const ctx = {plan: 'free'};
    const auth = makeAuth();
    const result = resolveScope({context: ctx}, auth);
    expect(result.scopeContext).toEqual(ctx);
  });

  it('auth scopeContext takes precedence over request body context', () => {
    const authCtx = {plan: 'enterprise'};
    const bodyCtx = {plan: 'free'};
    const auth = makeAuth({scopeContext: authCtx});
    const result = resolveScope({context: bodyCtx}, auth);
    expect(result.scopeContext).toEqual(authCtx);
  });

  it('scopeContext is undefined when neither auth nor body has it', () => {
    const result = resolveScope({});
    expect(result.scopeContext).toBeUndefined();
  });
});
