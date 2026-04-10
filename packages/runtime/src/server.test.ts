/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import {describe, it, expect, vi, beforeEach, afterEach} from 'vitest';
import request from 'supertest';
import {createServer} from './server.js';
import type {RoleProvider, RuntimeUser} from './role-provider.js';

const ROLE_TEST_CONFIG = {
  port: 0,
  host: '127.0.0.1',
  sessionTtlMs: 30_000,
  automations: [],
};

function makeRoleProvider(user: RuntimeUser | null): RoleProvider {
  return {
    async resolveUser() {
      return user;
    },
  };
}

describe('createServer', () => {
  let serverInstance: ReturnType<typeof createServer>;

  beforeEach(() => {
    vi.clearAllMocks();

    serverInstance = createServer({
      config: {
        port: 0,
        host: '127.0.0.1',
        sessionTtlMs: 30_000,
        automations: [],
      },
      version: '1.0.0-test',
    });
  });

  afterEach(async () => {
    await serverInstance.stop();
  });

  it('responds to GET /health', async () => {
    const res = await request(serverInstance.app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.version).toBe('1.0.0-test');
  });

  it('rejects POST /chat without bundle (no deploy_id)', async () => {
    const res = await request(serverInstance.app)
      .post('/chat')
      .send({message: 'hello'});

    // Without a bundle, session resolution fails
    expect(res.status).toBe(500);
  });

  it('rejects invalid POST /chat request', async () => {
    const res = await request(serverInstance.app)
      .post('/chat')
      .send({});

    expect(res.status).toBe(400);
  });

  it('returns 404 for non-existent routes', async () => {
    const res = await request(serverInstance.app).get('/nonexistent');
    expect(res.status).toBe(404);
  });
});

describe('createServer - /api/me', () => {
  let serverInstance: ReturnType<typeof createServer>;

  afterEach(async () => {
    if (serverInstance) await serverInstance.stop();
  });

  it('returns ops user by default (no roleProvider configured)', async () => {
    serverInstance = createServer({
      config: ROLE_TEST_CONFIG,
      version: 'test',
    });
    const res = await request(serverInstance.app).get('/api/me');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({id: 'local-dev', role: 'ops'});
  });

  it('returns user from configured RoleProvider', async () => {
    serverInstance = createServer({
      config: ROLE_TEST_CONFIG,
      roleProvider: makeRoleProvider({id: 'sally@acme.com', role: 'admin'}),
    });
    const res = await request(serverInstance.app).get('/api/me');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({id: 'sally@acme.com', role: 'admin'});
  });

  it('returns 401 when RoleProvider returns null', async () => {
    serverInstance = createServer({
      config: ROLE_TEST_CONFIG,
      roleProvider: makeRoleProvider(null),
    });
    const res = await request(serverInstance.app).get('/api/me');
    expect(res.status).toBe(401);
    expect(res.body).toEqual({
      error: {code: 'unauthenticated', message: 'Authentication required'},
    });
  });

  it('returns 500 when RoleProvider throws', async () => {
    serverInstance = createServer({
      config: ROLE_TEST_CONFIG,
      roleProvider: {
        async resolveUser() {
          throw new Error('database connection failed');
        },
      },
    });
    const res = await request(serverInstance.app).get('/api/me');
    expect(res.status).toBe(500);
    expect(res.body).toHaveProperty('error');
  });

  it('passes the request through to the provider', async () => {
    let capturedHeader: string | undefined;
    serverInstance = createServer({
      config: ROLE_TEST_CONFIG,
      roleProvider: {
        async resolveUser(req) {
          const auth = req.headers['authorization'];
          capturedHeader = typeof auth === 'string' ? auth : undefined;
          if (capturedHeader === 'Bearer test-token') {
            return {id: 'test-user', role: 'ops'};
          }
          return null;
        },
      },
    });

    const res = await request(serverInstance.app)
      .get('/api/me')
      .set('Authorization', 'Bearer test-token');

    expect(res.status).toBe(200);
    expect(capturedHeader).toBe('Bearer test-token');
    expect(res.body).toEqual({id: 'test-user', role: 'ops'});
  });
});
