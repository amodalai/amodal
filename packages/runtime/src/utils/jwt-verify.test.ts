/**
 * @license
 * Copyright 2025 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import type http from 'node:http';
import { generateKeyPair, SignJWT, exportJWK, calculateJwkThumbprint } from 'jose';
import type { CryptoKey } from 'jose';
import { createJWTVerifier } from './jwt-verify.js';

describe('jwt-verify', () => {
  let privateKey: CryptoKey;
  let publicKey: CryptoKey;
  let kid: string;
  let jwksServer: http.Server;
  let jwksUrl: string;
  let verifyJWT: ReturnType<typeof createJWTVerifier>;

  beforeAll(async () => {
    // Generate key pair for tests
    const pair = await generateKeyPair('ES256', { extractable: true });
    privateKey = pair.privateKey;
    publicKey = pair.publicKey;

    const publicJwk = await exportJWK(publicKey);
    kid = await calculateJwkThumbprint(publicJwk);

    // Start a minimal JWKS server
    const app = express();
    app.get('/.well-known/jwks.json', (_req, res) => {
      res.json({
        keys: [{ ...publicJwk, kid, alg: 'ES256', use: 'sig' }],
      });
    });

    jwksServer = await new Promise<http.Server>((resolve) => {
      const s = app.listen(0, '127.0.0.1', () => {
        resolve(s);
      });
    });

    const addr = jwksServer.address() as unknown as { port: number };
    jwksUrl = `http://127.0.0.1:${addr.port}/.well-known/jwks.json`;
    verifyJWT = createJWTVerifier({ jwksUrl });
  });

  afterAll(async () => {
    if (jwksServer) {
      await new Promise<void>((resolve, reject) => {
        jwksServer.close((err) => {
          if (err) reject(err);
          else resolve();
        });
      });
    }
  });

  it('verifies a valid platform JWT', async () => {
    const token = await new SignJWT({
      org_id: 'org-1',
      app_id: 'app-1',

    })
      .setProtectedHeader({ alg: 'ES256', kid })
      .setIssuer('aitize-platform')
      .setSubject('app-1')
      .setIssuedAt()
      .setExpirationTime('1h')
      .sign(privateKey);

    const claims = await verifyJWT(token);
    expect(claims).not.toBeNull();
    expect(claims?.org_id).toBe('org-1');
    expect(claims?.app_id).toBe('app-1');
    expect(claims?.app_id).toBe('app-1');
  });

  it('returns null for expired JWT', async () => {
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

    const claims = await verifyJWT(token);
    expect(claims).toBeNull();
  });

  it('returns null for wrong issuer', async () => {
    const token = await new SignJWT({
      org_id: 'org-1',
      app_id: 'app-1',

    })
      .setProtectedHeader({ alg: 'ES256', kid })
      .setIssuer('wrong-issuer')
      .setSubject('app-1')
      .setIssuedAt()
      .setExpirationTime('1h')
      .sign(privateKey);

    const claims = await verifyJWT(token);
    expect(claims).toBeNull();
  });

  it('returns null for invalid token', async () => {
    const claims = await verifyJWT('not-a-jwt');
    expect(claims).toBeNull();
  });

  it('extracts actor from JWT claims when present', async () => {
    const token = await new SignJWT({
      org_id: 'org-1',
      app_id: 'app-1',

      actor: 'alice@example.com',
    })
      .setProtectedHeader({ alg: 'ES256', kid })
      .setIssuer('aitize-platform')
      .setSubject('app-1')
      .setIssuedAt()
      .setExpirationTime('1h')
      .sign(privateKey);

    const claims = await verifyJWT(token);
    expect(claims).not.toBeNull();
    expect(claims?.actor).toBe('alice@example.com');
  });

  it('omits actor from claims when not in JWT', async () => {
    const token = await new SignJWT({
      org_id: 'org-1',
      app_id: 'app-1',

    })
      .setProtectedHeader({ alg: 'ES256', kid })
      .setIssuer('aitize-platform')
      .setSubject('app-1')
      .setIssuedAt()
      .setExpirationTime('1h')
      .sign(privateKey);

    const claims = await verifyJWT(token);
    expect(claims).not.toBeNull();
    expect(claims?.actor).toBeUndefined();
  });

  it('returns null for JWT signed with different key', async () => {
    const otherPair = await generateKeyPair('ES256', { extractable: true });
    const otherJwk = await exportJWK(otherPair.publicKey);
    const otherKid = await calculateJwkThumbprint(otherJwk);

    const token = await new SignJWT({
      org_id: 'org-1',
      app_id: 'app-1',

    })
      .setProtectedHeader({ alg: 'ES256', kid: otherKid })
      .setIssuer('aitize-platform')
      .setSubject('app-1')
      .setIssuedAt()
      .setExpirationTime('1h')
      .sign(otherPair.privateKey);

    const claims = await verifyJWT(token);
    expect(claims).toBeNull();
  });
});
