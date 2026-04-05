/**
 * @license
 * Copyright 2025 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import type { Response } from 'express';

/**
 * Auth context attached to `res.locals.authContext` after successful auth.
 * The auth middleware that populates this is provided by the hosting layer.
 */
export interface AuthContext {
  apiKey?: string;
  /** Raw Bearer token (JWT or ak_ key) for forwarding to platform API */
  token?: string;
  applicationId: string;
  authMethod: string;
}

const AUTH_CONTEXT_KEY = 'authContext';

/**
 * Get the auth context from response locals.
 */
export function getAuthContext(res: Response): AuthContext | undefined {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
  return res.locals[AUTH_CONTEXT_KEY] as AuthContext | undefined;
}
