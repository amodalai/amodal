/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import {existsSync, readdirSync, mkdirSync} from 'node:fs';
import {join} from 'node:path';
import {build} from 'esbuild';

export interface BuiltPage {
  name: string;
  outputPath: string;
}

/**
 * Compile user pages from pages/ directory into JS bundles.
 * Each page becomes a self-contained ES module that exports a default React component.
 * Returns the list of built pages and the output directory.
 */
export async function buildPages(repoPath: string): Promise<{pages: BuiltPage[]; outDir: string}> {
  const pagesDir = join(repoPath, 'pages');
  if (!existsSync(pagesDir)) {
    return {pages: [], outDir: ''};
  }

  const files = readdirSync(pagesDir, {withFileTypes: true})
    .filter((e) => e.isFile() && /\.(tsx|jsx|ts|js)$/.test(e.name))
    .map((e) => e.name);

  if (files.length === 0) {
    return {pages: [], outDir: ''};
  }

  const outDir = join(repoPath, '.amodal', 'pages-build');
  mkdirSync(outDir, {recursive: true});

  const entryPoints: Record<string, string> = {};
  for (const file of files) {
    const name = file.replace(/\.(tsx|jsx|ts|js)$/, '');
    entryPoints[name] = join(pagesDir, file);
  }

  await build({
    entryPoints,
    outdir: outDir,
    bundle: true,
    format: 'esm',
    platform: 'browser',
    jsx: 'automatic',
    splitting: true,
    external: ['react', 'react-dom', 'react/jsx-runtime'],
    outExtension: {'.js': '.mjs'},
    logLevel: 'warning',
  });

  const pages: BuiltPage[] = files.map((file) => {
    const name = file.replace(/\.(tsx|jsx|ts|js)$/, '');
    return {name, outputPath: join(outDir, `${name}.mjs`)};
  });

  return {pages, outDir};
}
