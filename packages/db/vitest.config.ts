/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    reporters: ['default'],
    testTimeout: 10000,
    hookTimeout: 10000,
    pool: 'forks',
    silent: true,
  },
});
