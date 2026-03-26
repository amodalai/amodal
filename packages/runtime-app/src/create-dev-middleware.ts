/**
 * @license
 * Copyright 2025 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import { amodalPlugin } from './vite-plugin-amodal.js';
import * as path from 'node:path';

/**
 * Creates a Vite dev server in middleware mode for embedding in an Express server.
 *
 * The Vite server handles:
 * - Serving the runtime app SPA
 * - HMR (Hot Module Replacement)
 * - Developer page module loading
 * - Virtual module generation (manifest, pages)
 *
 * API routes (e.g., /api/*, /chat) should be mounted before this middleware
 * so Express handles them first.
 *
 * @param repoPath Absolute path to the developer's amodal repo
 * @param runtimeAppRoot Absolute path to the runtime-app package (for resolving index.html)
 * @returns Express-compatible middleware function
 */
export async function createDevMiddleware(
  repoPath: string,
  runtimeAppRoot?: string,
): Promise<(req: unknown, res: unknown, next: unknown) => void> {
  const { createServer } = await import('vite');
  const reactPlugin = (await import('@vitejs/plugin-react')).default;

  const appRoot = runtimeAppRoot ?? path.resolve(import.meta.dirname, '..');

  const vite = await createServer({
    root: appRoot,
    plugins: [
      reactPlugin(),
      amodalPlugin({ repoPath }),
    ],
    server: {
      middlewareMode: true,
      hmr: true,
    },
    resolve: {
      alias: {
        '@': path.resolve(appRoot, 'src'),
      },
    },
    // CSS is handled by the Vite pipeline, not postcss config in middleware mode
    css: {
      postcss: {
        plugins: [],
      },
    },
  });

  // Return the Vite middleware (Connect-compatible, works with Express)
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- Vite Connect middleware is Express-compatible
  return vite.middlewares as unknown as (req: unknown, res: unknown, next: unknown) => void;
}
