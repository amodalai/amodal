/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwind from 'tailwindcss';
import path from 'node:path';

// Normalize BASE_PATH: ensure leading slash, strip trailing slash.
// Empty or unset means '/' (serve at root — default behavior).
function resolveBase(): string {
  const raw = process.env['BASE_PATH'] ?? '';
  if (!raw) return '/';
  const trimmed = raw.endsWith('/') ? raw.slice(0, -1) : raw;
  const withLeading = trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
  return `${withLeading}/`;
}

export default defineConfig({
  base: resolveBase(),
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
  css: {
    postcss: {
      plugins: [tailwind()],
    },
  },
  server: {
    proxy: {
      '/api': 'http://localhost:3848',
    },
  },
});
