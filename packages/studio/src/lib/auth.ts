/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import type { StudioUser } from './types';

// ---------------------------------------------------------------------------
// Auth interface
// ---------------------------------------------------------------------------

/**
 * Authentication interface for the studio.
 * Implement this to provide custom user resolution (e.g. JWT verification).
 * The default implementation returns a fixed local-dev user.
 */
export interface StudioAuth {
  getUser(req: Request): Promise<StudioUser>;
}

// ---------------------------------------------------------------------------
// Auth provider override
// ---------------------------------------------------------------------------

let authProvider: StudioAuth | null = null;

/**
 * Set a custom auth provider. When set, {@link getUser} delegates to it
 * instead of the default local-dev auth.
 *
 * Call once at application startup.
 * Pass `null` to revert to the default local-dev behavior.
 */
export function setAuthProvider(provider: StudioAuth | null): void {
  authProvider = provider;
}

// ---------------------------------------------------------------------------
// Local dev auth (default)
// ---------------------------------------------------------------------------

const LOCAL_DEV_USER: StudioUser = {
  userId: 'local-dev',
  displayName: 'Local Developer',
};

class LocalDevAuth implements StudioAuth {
  async getUser(_req: Request): Promise<StudioUser> {
    return LOCAL_DEV_USER;
  }
}

const localDevAuth = new LocalDevAuth();

/**
 * Get the authenticated user from the request.
 *
 * If a custom auth provider has been set via {@link setAuthProvider},
 * delegates to it. Otherwise returns the local-dev user.
 */
export async function getUser(req: Request): Promise<StudioUser> {
  const provider = authProvider ?? localDevAuth;
  return provider.getUser(req);
}
