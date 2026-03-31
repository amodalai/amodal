/**
 * @license
 * Copyright 2025 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import { describe, it, expect, vi, beforeEach, afterEach, beforeAll } from 'vitest';
import express from 'express';
import request from 'supertest';
import { generateKeyPair, SignJWT, exportJWK, calculateJwkThumbprint } from 'jose';
import type { CryptoKey } from 'jose';
import { createAuthMiddleware, getAuthContext } from './auth.js';
import { errorHandler } from './error-handler.js';

// Mock fetch globally
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

function meResponse(orgId = 'org-123', appId = 'app-456') {
  return {
    ok: true,
    json: async () => ({
      org: { id: orgId },
      app: { id: appId },
      apps: [{ id: appId }],
      user: null,
    }),
  };
}

function createTestApp(platformApiUrl = 'http://localhost:4000', jwksUrl?: string) {
  const app = express();
  app.use(express.json());

  const authMiddleware = createAuthMiddleware({ platformApiUrl, jwksUrl });

  app.get('/test', authMiddleware, (_req, res) => {
    const ctx = getAuthContext(res);
    res.json({
      authenticated: true,
      token: ctx?.token,
      orgId: ctx?.orgId,
      applicationId: ctx?.applicationId,
      authMethod: ctx?.authMethod,
      actor: ctx?.actor,
    });
  });

  app.use(errorHandler);
  return app;
}

describe('auth middleware', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('rejects requests without Authorization header', async () => {
    const app = createTestApp();
    const res = await request(app).get('/test');

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHORIZED');
    expect(res.body.error.message).toContain('Missing Authorization');
  });

  it('rejects non-Bearer auth schemes', async () => {
    const app = createTestApp();
    const res = await request(app)
      .get('/test')
      .set('Authorization', 'Basic abc123');

    expect(res.status).toBe(401);
    expect(res.body.error.message).toContain('Bearer scheme');
  });

  it('rejects tokens without ak_ prefix when no JWKS configured', async () => {
    // Create app without JWKS URL — will fail createJWTVerifier
    const app = express();
    app.use(express.json());
    const authMiddleware = createAuthMiddleware({
      platformApiUrl: 'http://localhost:4000',
      jwksUrl: 'not-a-valid-url',
    });
    app.get('/test', authMiddleware, (_req, res) => {
      res.json({ authenticated: true });
    });
    app.use(errorHandler);

    const res = await request(app)
      .get('/test')
      .set('Authorization', 'Bearer some-jwt-token');

    expect(res.status).toBe(401);
  });

  it('validates ak_ keys against platform API and returns full context', async () => {
    mockFetch.mockResolvedValueOnce(meResponse('org-123', 'app-456'));

    const app = createTestApp();
    const res = await request(app)
      .get('/test')
      .set('Authorization', 'Bearer ak_test-key');

    expect(res.status).toBe(200);
    expect(res.body.authenticated).toBe(true);
    expect(res.body.token).toBe('ak_test-key');
    expect(res.body.orgId).toBe('org-123');
    expect(res.body.applicationId).toBe('app-456');
    expect(res.body.authMethod).toBe('api_key');

    // Verify fetch was called with correct args
    expect(mockFetch).toHaveBeenCalledWith(
      'http://localhost:4000/api/me',
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer ak_test-key',
        }),
      }),
    );
  });

  it('rejects invalid ak_ keys (platform returns non-ok)', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 401,
    });

    const app = createTestApp();
    const res = await request(app)
      .get('/test')
      .set('Authorization', 'Bearer ak_bad-key');

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHORIZED');
  });

  it('caches validated keys', async () => {
    mockFetch.mockResolvedValue(meResponse());

    const app = createTestApp();

    // First request — validates against platform API
    await request(app)
      .get('/test')
      .set('Authorization', 'Bearer ak_cached-key');

    expect(mockFetch).toHaveBeenCalledTimes(1);

    // Second request — should use cache
    const res = await request(app)
      .get('/test')
      .set('Authorization', 'Bearer ak_cached-key');

    expect(res.status).toBe(200);
    expect(mockFetch).toHaveBeenCalledTimes(1); // No additional fetch
  });

  it('returns 502 when platform API is unreachable', async () => {
    mockFetch.mockRejectedValueOnce(new Error('Connection refused'));

    const app = createTestApp();
    const res = await request(app)
      .get('/test')
      .set('Authorization', 'Bearer ak_test-key');

    expect(res.status).toBe(502);
    expect(res.body.error.code).toBe('AUTH_UPSTREAM_ERROR');
  });

  describe('JWT verification', () => {
    let privateKey: CryptoKey;
    let kid: string;
    let jwksJson: { keys: Array<Record<string, unknown>> };
    const jwksUrl = 'http://127.0.0.1:9999/.well-known/jwks.json';

    beforeAll(async () => {
      const pair = await generateKeyPair('ES256', { extractable: true });
      privateKey = pair.privateKey;
      const publicJwk = await exportJWK(pair.publicKey);
      kid = await calculateJwkThumbprint(publicJwk);
      jwksJson = {
        keys: [{ ...publicJwk, kid, alg: 'ES256', use: 'sig' }],
      };
    });

    it('validates platform JWTs locally without /api/me calls', async () => {
      // Mock fetch to serve JWKS
      mockFetch.mockImplementation(async (url: string) => {
        if (url.includes('.well-known/jwks.json')) {
          return { ok: true, status: 200, json: async () => jwksJson };
        }
        throw new Error(`Unexpected fetch: ${url}`);
      });

      const token = await new SignJWT({
        org_id: 'org-jwt',
        app_id: 'app-jwt',

      })
        .setProtectedHeader({ alg: 'ES256', kid })
        .setIssuer('aitize-platform')
        .setSubject('app-jwt')
        .setIssuedAt()
        .setExpirationTime('1h')
        .sign(privateKey);

      const app = createTestApp('http://localhost:4000', jwksUrl);
      const res = await request(app)
        .get('/test')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.token).toBe(token);
      expect(res.body.orgId).toBe('org-jwt');
      expect(res.body.applicationId).toBe('app-jwt');
      expect(res.body.applicationId).toBe('app-jwt');
      expect(res.body.authMethod).toBe('platform_jwt');

      // Only JWKS fetch should have been made, not /api/me
      for (const call of mockFetch.mock.calls) {
        expect(String(call[0])).not.toContain('/api/me');
      }
    });

    it('includes actor in AuthContext when JWT has actor claim', async () => {
      mockFetch.mockImplementation(async (url: string) => {
        if (url.includes('.well-known/jwks.json')) {
          return { ok: true, status: 200, json: async () => jwksJson };
        }
        throw new Error(`Unexpected fetch: ${url}`);
      });

      const token = await new SignJWT({
        org_id: 'org-jwt',
        app_id: 'app-jwt',

        actor: 'bob@example.com',
      })
        .setProtectedHeader({ alg: 'ES256', kid })
        .setIssuer('aitize-platform')
        .setSubject('app-jwt')
        .setIssuedAt()
        .setExpirationTime('1h')
        .sign(privateKey);

      const app = createTestApp('http://localhost:4000', jwksUrl);
      const res = await request(app)
        .get('/test')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.actor).toBe('bob@example.com');
      expect(res.body.authMethod).toBe('platform_jwt');
    });

    it('omits actor from AuthContext when JWT has no actor claim', async () => {
      mockFetch.mockImplementation(async (url: string) => {
        if (url.includes('.well-known/jwks.json')) {
          return { ok: true, status: 200, json: async () => jwksJson };
        }
        throw new Error(`Unexpected fetch: ${url}`);
      });

      const token = await new SignJWT({
        org_id: 'org-jwt',
        app_id: 'app-jwt',

      })
        .setProtectedHeader({ alg: 'ES256', kid })
        .setIssuer('aitize-platform')
        .setSubject('app-jwt')
        .setIssuedAt()
        .setExpirationTime('1h')
        .sign(privateKey);

      const app = createTestApp('http://localhost:4000', jwksUrl);
      const res = await request(app)
        .get('/test')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.actor).toBeUndefined();
    });

    it('rejects expired JWTs', async () => {
      mockFetch.mockImplementation(async (url: string) => {
        if (url.includes('.well-known/jwks.json')) {
          return { ok: true, status: 200, json: async () => jwksJson };
        }
        throw new Error(`Unexpected fetch: ${url}`);
      });

      const token = await new SignJWT({
        org_id: 'org-1',
        app_id: 'app-1',
      })
        .setProtectedHeader({ alg: 'ES256', kid })
        .setIssuer('aitize-platform')
        .setSubject('app-1')
        .setIssuedAt(Math.floor(Date.now() / 1000) - 7200)
        .setExpirationTime(Math.floor(Date.now() / 1000) - 3600)
        .sign(privateKey);

      const app = createTestApp('http://localhost:4000', jwksUrl);
      const res = await request(app)
        .get('/test')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(401);
    });
  });
});
