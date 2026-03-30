/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import {existsSync, readdirSync, mkdirSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {build} from 'esbuild';

export interface BuiltPage {
  name: string;
  outputPath: string;
}

/**
 * Compile user pages from pages/ directory into JS bundles.
 * Each page is compiled as an IIFE that registers itself on window.__AMODAL_PAGES__.
 * React is expected to be available on window.React (provided by the SPA).
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

  const pages: BuiltPage[] = [];

  for (const file of files) {
    const name = file.replace(/\.(tsx|jsx|ts|js)$/, '');
    const entryPath = join(pagesDir, file);
    const outputPath = join(outDir, `${name}.js`);

    // Create a wrapper that imports the page and registers it globally
    const wrapperPath = join(outDir, `_entry_${name}.tsx`);
    writeFileSync(wrapperPath, `
import PageComponent from '${entryPath.replace(/\\/g, '/')}';
window.__AMODAL_PAGES__ = window.__AMODAL_PAGES__ || {};
window.__AMODAL_PAGES__['${name}'] = PageComponent;
`);

    await build({
      entryPoints: [wrapperPath],
      outfile: outputPath,
      bundle: true,
      format: 'iife',
      platform: 'browser',
      jsx: 'automatic',
      // React comes from the SPA — inject a shim that reads from window.React
      external: ['react', 'react-dom', 'react/jsx-runtime', 'react/jsx-dev-runtime'],
      banner: {
        js: `
var React = window.React;
var require = function(m) {
  if (m === 'react' || m === 'react/jsx-runtime' || m === 'react/jsx-dev-runtime') return window.React;
  if (m === 'react-dom') return window.ReactDOM;
  throw new Error('Cannot require ' + m);
};
`,
      },
      logLevel: 'warning',
    });

    pages.push({name, outputPath});
  }

  return {pages, outDir};
}
