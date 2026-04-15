/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

// Re-export from the canonical auth module so server routes and external
// consumers (cloud-studio) use the same auth provider with setAuthProvider().
export { getUser } from '../../lib/auth.js';
