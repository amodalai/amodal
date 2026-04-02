/**
 * @license
 * Copyright 2025 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import react from '@vitejs/plugin-react';
import tailwind from 'tailwindcss';
import { defineConfig } from 'vite';
import path from 'node:path';
import { amodalPlugin } from './src/vite-plugin-amodal';

const REPO_PATH = process.env['AMODAL_REPO_PATH'] ?? path.resolve(__dirname, '../../demo');

export default defineConfig({
  plugins: [react(), amodalPlugin({ repoPath: REPO_PATH })],
  base: '/',
  css: {
    postcss: {
      plugins: [tailwind()],
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
      'recharts': path.resolve(__dirname, 'node_modules/recharts'),
    },
  },
  server: {
    proxy: {
      '/api': 'http://localhost:3847',
      '/chat': 'http://localhost:3847',
      '/health': 'http://localhost:3847',
      '/automations': 'http://localhost:3847',
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test-setup.ts'],
    css: false,
  },
});
