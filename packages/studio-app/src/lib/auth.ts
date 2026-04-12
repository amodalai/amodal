/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import type { NextRequest } from 'next/server';
import type { StudioUser } from './types';

// ---------------------------------------------------------------------------
// Auth interface
// ---------------------------------------------------------------------------

/**
 * Authentication interface for the studio.
 *
 * Phase 1 (local dev) always returns a fixed local-dev user.
 * Future phases will read a session cookie or token from the request.
 */
export interface StudioAuth {
  getUser(req: NextRequest): Promise<StudioUser>;
}

// ---------------------------------------------------------------------------
// Local dev auth (Phase 1)
// ---------------------------------------------------------------------------

const LOCAL_DEV_USER: StudioUser = {
  userId: 'local-dev',
  displayName: 'Local Developer',
};

class LocalDevAuth implements StudioAuth {
  async getUser(_req: NextRequest): Promise<StudioUser> {
    return LOCAL_DEV_USER;
  }
}

const localDevAuth = new LocalDevAuth();

/**
 * Get the authenticated user from the request.
 * Phase 1: always returns the local-dev user.
 */
export async function getUser(req: NextRequest): Promise<StudioUser> {
  return localDevAuth.getUser(req);
}
