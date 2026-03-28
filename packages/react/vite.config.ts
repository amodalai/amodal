/**
 * @license
 * Copyright 2025 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import dts from 'vite-plugin-dts';
import path from 'node:path';

export default defineConfig({
  plugins: [
    react(),
    dts({
      include: ['src'],
      exclude: ['src/**/*.test.ts', 'src/**/*.test.tsx', 'src/test/**', 'test/**'],
    }),
  ],
  build: {
    lib: {
      entry: {
        react: path.resolve(__dirname, 'src/index.ts'),
        client: path.resolve(__dirname, 'src/client/index.ts'),
        widget: path.resolve(__dirname, 'src/widget/index.ts'),
      },
      formats: ['es'],
    },
    rollupOptions: {
      external: ['react', 'react-dom', 'react/jsx-runtime'],
      output: {
        globals: {
          react: 'React',
          'react-dom': 'ReactDOM',
          'react/jsx-runtime': 'jsxRuntime',
        },
        assetFileNames: (info) => {
          // Route widget CSS to widget.css, main CSS to react.css
          if (info.name === 'widget.css') return 'widget.css';
          return 'react.css';
        },
      },
    },
    sourcemap: true,
  },
});
