/**
 * @license
 * Copyright 2025 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import { createRemoteJWKSet, jwtVerify } from 'jose';
import type { JWTVerifyGetKey } from 'jose';

export interface JWTVerifierOptions {
  jwksUrl: string;
  issuer?: string;
}

export interface PlatformJWTClaims {
  org_id: string;
  app_id: string;
  tenant_id: string;
  actor?: string;
}

/**
 * Create a JWT verifier that validates tokens against a remote JWKS endpoint.
 * The JWKS is auto-fetched and cached by the `jose` library.
 */
export function createJWTVerifier(
  options: JWTVerifierOptions,
): (token: string) => Promise<PlatformJWTClaims | null> {
  const jwks: JWTVerifyGetKey = createRemoteJWKSet(new URL(options.jwksUrl));
  const issuer = options.issuer ?? 'aitize-platform';

  return async (token: string): Promise<PlatformJWTClaims | null> => {
    try {
      const { payload } = await jwtVerify(token, jwks, { issuer });
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      const actor = payload['actor'] as string | undefined;
      return {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
        org_id: (payload['org_id'] as string) ?? '',
        // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
        app_id: (payload['app_id'] as string) ?? '',
        // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
        tenant_id: (payload['tenant_id'] as string) ?? '',
        ...(actor ? { actor } : {}),
      };
    } catch {
      return null;
    }
  };
}
