/**
 * @license
 * Copyright 2025 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    reporters: ['default'],
    testTimeout: 30000,
    hookTimeout: 30000,
    pool: 'forks',
    silent: true,
  },
});
