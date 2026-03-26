/**
 * @license
 * Copyright 2025 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import type { Request, Response, NextFunction } from 'express';
import { AppError } from './error-handler.js';
import { createJWTVerifier } from '../utils/jwt-verify.js';
import type { PlatformJWTClaims } from '../utils/jwt-verify.js';

/**
 * Auth context attached to `res.locals.authContext` after successful auth.
 * Contains the caller's API key and resolved platform context from /api/me.
 */
export interface AuthContext {
  apiKey?: string;
  /** Raw Bearer token (JWT or ak_ key) for forwarding to platform API */
  token?: string;
  orgId: string;
  applicationId: string;
  tenantId: string;
  authMethod: 'api_key' | 'platform_jwt';
  actor?: string;
}

export interface AuthMiddlewareOptions {
  /** Platform API base URL (e.g., "http://localhost:4000") */
  platformApiUrl: string;
  /** TTL in ms for cached key validations (default: 5 minutes) */
  cacheTtlMs?: number;
  /** JWKS URL for JWT verification (defaults to platformApiUrl/.well-known/jwks.json) */
  jwksUrl?: string;
}

interface CacheEntry {
  orgId: string;
  applicationId: string;
  tenantId: string;
  expiresAt: number;
}

interface MeResponse {
  org?: { id?: string } | null;
  app?: { id?: string } | null;
  tenant?: { id?: string } | null;
  apps?: Array<{ id?: string }>;
  tenants?: Array<{ id?: string }>;
}

const AUTH_CONTEXT_KEY = 'authContext';

/**
 * Get the auth context from response locals.
 */
export function getAuthContext(res: Response): AuthContext | undefined {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
  return res.locals[AUTH_CONTEXT_KEY] as AuthContext | undefined;
}

/**
 * Express middleware that validates Bearer tokens.
 *
 * Supports dual auth:
 * - `ak_` prefixed keys: validated via `GET /api/me` on the platform API (cached)
 * - JWTs: validated locally via JWKS (zero network overhead per request)
 */
export function createAuthMiddleware(
  options: AuthMiddlewareOptions,
): (req: Request, res: Response, next: NextFunction) => void {
  const { platformApiUrl, cacheTtlMs = 5 * 60 * 1000 } = options;
  const cache = new Map<string, CacheEntry>();

  // Set up JWT verifier if JWKS URL available
  const jwksUrl = options.jwksUrl ?? `${platformApiUrl}/.well-known/jwks.json`;
  let verifyJWT: ((token: string) => Promise<PlatformJWTClaims | null>) | null = null;
  try {
    verifyJWT = createJWTVerifier({ jwksUrl });
  } catch {
    // JWKS URL invalid — JWT verification disabled
  }

  return (req: Request, res: Response, next: NextFunction): void => {
    const authHeader = req.headers['authorization'];
    if (!authHeader) {
      next(new AppError(401, 'UNAUTHORIZED', 'Missing Authorization header'));
      return;
    }

    if (!authHeader.startsWith('Bearer ')) {
      next(
        new AppError(401, 'UNAUTHORIZED', 'Authorization header must use Bearer scheme'),
      );
      return;
    }

    const token = authHeader.slice(7);

    if (token.startsWith('ak_')) {
      // API key flow — validate via /api/me (cached)
      const cached = cache.get(token);
      if (cached && cached.expiresAt > Date.now()) {
        res.locals[AUTH_CONTEXT_KEY] = {
          apiKey: token,
          token,
          orgId: cached.orgId,
          applicationId: cached.applicationId,
          tenantId: cached.tenantId,
          authMethod: 'api_key',
        };
        next();
        return;
      }

      void validateKey(platformApiUrl, token).then(
        (result) => {
          if (!result) {
            next(new AppError(401, 'UNAUTHORIZED', 'Invalid API key'));
            return;
          }
          cache.set(token, { ...result, expiresAt: Date.now() + cacheTtlMs });
          res.locals[AUTH_CONTEXT_KEY] = {
            apiKey: token,
            token,
            ...result,
            authMethod: 'api_key',
          };
          next();
        },
        (err: unknown) => {
          next(
            new AppError(
              502,
              'AUTH_UPSTREAM_ERROR',
              `Failed to validate API key: ${err instanceof Error ? err.message : 'Unknown error'}`,
            ),
          );
        },
      );
    } else if (verifyJWT) {
      // JWT flow — validate locally via JWKS
      void verifyJWT(token).then(
        (claims) => {
          if (!claims) {
            next(new AppError(401, 'UNAUTHORIZED', 'Invalid or expired token'));
            return;
          }
          res.locals[AUTH_CONTEXT_KEY] = {
            token,
            orgId: claims.org_id,
            applicationId: claims.app_id,
            tenantId: claims.tenant_id,
            authMethod: 'platform_jwt',
            ...(claims.actor ? { actor: claims.actor } : {}),
          };
          next();
        },
        () => {
          next(new AppError(401, 'UNAUTHORIZED', 'Token verification failed'));
        },
      );
    } else {
      next(new AppError(401, 'UNAUTHORIZED', 'Invalid API key format'));
    }
  };
}

/**
 * Validate an API key by calling the platform API's /api/me endpoint.
 * Returns org/app/tenant context if valid, null if invalid.
 */
async function validateKey(
  platformApiUrl: string,
  apiKey: string,
): Promise<{ orgId: string; applicationId: string; tenantId: string } | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);

  try {
    const response = await fetch(`${platformApiUrl}/api/me`, {
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: 'application/json',
      },
    });
    clearTimeout(timer);

    if (!response.ok) {
      return null;
    }

    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
    const data = (await response.json()) as MeResponse;
    // Prefer singular fields, fall back to arrays
    const orgId = data.org?.id ?? '';
    const applicationId = data.app?.id ?? data.apps?.[0]?.id ?? '';
    const tenantId = data.tenant?.id ?? data.tenants?.[0]?.id ?? '';
    return { orgId, applicationId, tenantId };
  } catch {
    clearTimeout(timer);
    throw new Error('Platform API unreachable');
  }
}
