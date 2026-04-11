/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import {describe, it, expect} from 'vitest';
import type {Request} from 'express';

import {createStudioAuthFromRoleProvider} from './studio-auth-adapter.js';
import {defaultRoleProvider} from '../role-provider.js';
import type {RoleProvider, RuntimeUser} from '../role-provider.js';

// A bare stand-in for Express `Request`. None of the adapter's logic reads
// off the request object — it just forwards to the RoleProvider — so an
// empty object cast through `unknown` is enough for the adapter tests.
const FAKE_REQ = {} as unknown as Request;

function providerReturning(user: RuntimeUser | null): RoleProvider {
  return {
    async resolveUser() {
      return user;
    },
  };
}

describe('createStudioAuthFromRoleProvider', () => {
  it('returns ok:true with ops role when wrapping defaultRoleProvider', async () => {
    const auth = createStudioAuthFromRoleProvider(defaultRoleProvider);
    const result = await auth.authorize(FAKE_REQ);
    expect(result).toEqual({
      ok: true,
      user: {userId: 'local-dev', role: 'ops'},
    });
  });

  it('returns ok:true with admin role when provider returns admin', async () => {
    const auth = createStudioAuthFromRoleProvider(
      providerReturning({id: 'sally@example.com', role: 'admin'}),
    );
    const result = await auth.authorize(FAKE_REQ);
    expect(result).toEqual({
      ok: true,
      user: {userId: 'sally@example.com', role: 'admin'},
    });
  });

  it('returns forbidden when provider returns a user role', async () => {
    const auth = createStudioAuthFromRoleProvider(
      providerReturning({id: 'viewer@example.com', role: 'user'}),
    );
    const result = await auth.authorize(FAKE_REQ);
    expect(result).toEqual({ok: false, reason: 'forbidden'});
  });

  it('returns unauthenticated when provider returns null', async () => {
    const auth = createStudioAuthFromRoleProvider(providerReturning(null));
    const result = await auth.authorize(FAKE_REQ);
    expect(result).toEqual({ok: false, reason: 'unauthenticated'});
  });

  it('propagates provider infrastructure errors', async () => {
    const boom = new Error('identity provider down');
    const auth = createStudioAuthFromRoleProvider({
      async resolveUser() {
        throw boom;
      },
    });
    await expect(auth.authorize(FAKE_REQ)).rejects.toBe(boom);
  });
});
