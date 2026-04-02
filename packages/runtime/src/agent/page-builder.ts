/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import {existsSync, readdirSync, mkdirSync, writeFileSync, readFileSync} from 'node:fs';
import {join} from 'node:path';
import {build} from 'esbuild';

export interface PageMetadata {
  description?: string;
  stores?: string[];
  automations?: string[];
}

export interface BuiltPage {
  name: string;
  outputPath: string;
  metadata: PageMetadata;
}

/**
 * Compile user pages from pages/ directory into JS bundles.
 * Each page is compiled as an IIFE that registers itself on window.__AMODAL_PAGES__.
 * React is expected to be available on window.React (provided by the SPA).
 */
export async function buildPages(repoPath: string): Promise<{pages: BuiltPage[]; outDir: string}> {
  // Collect page entries: {name, entryPath} — local pages override package pages
  const pageFileExt = /\.(tsx|jsx|ts|js)$/;
  const pageEntries = new Map<string, string>();

  // 1. Scan installed packages for pages (lower priority)
  const scopeDir = join(repoPath, 'amodal_packages', '.npm', 'node_modules', '@amodalai');
  if (existsSync(scopeDir)) {
    try {
      const pkgDirs = readdirSync(scopeDir, {withFileTypes: true}).filter((e) => e.isDirectory());
      for (const pkgDir of pkgDirs) {
        const pkgPagesDir = join(scopeDir, pkgDir.name, 'pages');
        if (!existsSync(pkgPagesDir)) continue;
        const pkgFiles = readdirSync(pkgPagesDir, {withFileTypes: true}).filter(
          (e) => e.isFile() && pageFileExt.test(e.name),
        );
        for (const f of pkgFiles) {
          const name = f.name.replace(pageFileExt, '');
          pageEntries.set(name, join(pkgPagesDir, f.name));
        }
      }
    } catch {
      // Ignore errors reading package dirs
    }
  }

  // 2. Scan local pages/ directory (higher priority — overwrites package entries)
  const pagesDir = join(repoPath, 'pages');
  if (existsSync(pagesDir)) {
    const localFiles = readdirSync(pagesDir, {withFileTypes: true}).filter(
      (e) => e.isFile() && pageFileExt.test(e.name),
    );
    for (const f of localFiles) {
      const name = f.name.replace(pageFileExt, '');
      pageEntries.set(name, join(pagesDir, f.name));
    }
  }

  if (pageEntries.size === 0) {
    return {pages: [], outDir: ''};
  }

  const outDir = join(repoPath, '.amodal', 'pages-build');
  mkdirSync(outDir, {recursive: true});

  const pages: BuiltPage[] = [];

  for (const [name, entryPath] of pageEntries) {
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
      // Use classic JSX transform so pages use React.createElement from window.React
      jsx: 'transform',
      jsxFactory: 'React.createElement',
      jsxFragment: 'React.Fragment',
      external: ['react', 'react-dom'],
      banner: {
        js: `
var React = window.React;
var require = function(m) {
  if (m === 'react') return window.React;
  if (m === 'react-dom') return window.ReactDOM;
  throw new Error('Cannot require ' + m);
};
`,
      },
      logLevel: 'warning',
    });

    const metadata = extractPageMetadata(entryPath);
    pages.push({name, outputPath, metadata});
  }

  return {pages, outDir};
}

/**
 * Extract page metadata from the `export const page = { ... }` declaration.
 * Uses simple regex parsing — doesn't require evaluating the module.
 */
function extractPageMetadata(filePath: string): PageMetadata {
  try {
    const source = readFileSync(filePath, 'utf-8');
    // Match: export const page = { ... };
    const match = source.match(/export\s+const\s+page\s*=\s*(\{[\s\S]*?\n\});/);
    if (!match) return {};
    // Clean the object literal: strip trailing commas, convert single quotes to double
    let objStr = match[1]
      .replace(/,\s*}/g, '}')
      .replace(/,\s*]/g, ']')
      .replace(/'/g, '"');
    // Remove unquoted keys and re-quote them
    objStr = objStr.replace(/(\w+)\s*:/g, '"$1":');
    // Fix double-quoted keys that were already quoted
    objStr = objStr.replace(/""+/g, '"');
    const parsed: unknown = JSON.parse(objStr);
    if (!parsed || typeof parsed !== 'object') return {};
     
    const obj = parsed as { description?: unknown; stores?: unknown; automations?: unknown };
    return {
      description: typeof obj.description === 'string' ? obj.description : undefined,
      stores: Array.isArray(obj.stores) ? obj.stores.filter((s): s is string => typeof s === 'string') : undefined,
      automations: Array.isArray(obj.automations) ? obj.automations.filter((s): s is string => typeof s === 'string') : undefined,
    };
  } catch {
    return {};
  }
}
