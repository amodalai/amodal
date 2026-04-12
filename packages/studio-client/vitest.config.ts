/**
 * @license
 * Copyright 2025 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    reporters: ['default'],
    testTimeout: 10000,
    hookTimeout: 10000,
    silent: true,
  },
});
