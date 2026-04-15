/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import type { Request } from 'express';
import type { StudioUser } from '../../lib/types.js';

const LOCAL_DEV_USER: StudioUser = {
  userId: 'local-dev',
  displayName: 'Local Developer',
};

export async function getUser(_req: Request): Promise<StudioUser> {
  return LOCAL_DEV_USER;
}
