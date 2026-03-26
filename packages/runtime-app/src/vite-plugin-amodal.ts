/**
 * @license
 * Copyright 2025 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import * as path from 'node:path';
import type { Plugin, ViteDevServer } from 'vite';

/**
 * Page configuration extracted from a developer's page file.
 */
export interface PageConfig {
  name: string;
  icon?: string;
  description?: string;
  context?: Record<string, string>;
  hidden?: boolean;
  filePath: string;
}

/**
 * Automation info extracted from the automations/ directory.
 */
export interface AutomationConfig {
  name: string;
  title?: string;
  schedule?: string;
  trigger: string;
}

export interface AmodalPluginOptions {
  /** Absolute path to the developer's amodal repo. */
  repoPath: string;
}

const VIRTUAL_MANIFEST = 'virtual:amodal-manifest';
const VIRTUAL_PAGES = 'virtual:amodal-pages';
const RESOLVED_MANIFEST = '\0' + VIRTUAL_MANIFEST;
const RESOLVED_PAGES = '\0' + VIRTUAL_PAGES;

/**
 * Vite plugin that scans the developer's repo and provides virtual modules
 * for the runtime app's manifest (stores, pages, automations) and page components.
 */
export function amodalPlugin(options: AmodalPluginOptions): Plugin {
  const { repoPath } = options;
  let server: ViteDevServer | undefined;

  return {
    name: 'vite-plugin-amodal',

    configureServer(srv) {
      server = srv;
    },

    resolveId(id) {
      if (id === VIRTUAL_MANIFEST) return RESOLVED_MANIFEST;
      if (id === VIRTUAL_PAGES) return RESOLVED_PAGES;
      return null;
    },

    load(id) {
      if (id === RESOLVED_MANIFEST) {
        return generateManifestModule(repoPath);
      }
      if (id === RESOLVED_PAGES) {
        return generatePagesModule(repoPath);
      }
      return null;
    },

    handleHotUpdate({ file }) {
      if (!server) return;

      // Invalidate virtual modules when repo files change
      const rel = path.relative(repoPath, file);
      if (
        rel.startsWith('stores/') ||
        rel.startsWith('pages/') ||
        rel.startsWith('automations/')
      ) {
        const manifestModule = server.moduleGraph.getModuleById(RESOLVED_MANIFEST);
        const pagesModule = server.moduleGraph.getModuleById(RESOLVED_PAGES);

        const modules = [];
        if (manifestModule) {
          server.moduleGraph.invalidateModule(manifestModule);
          modules.push(manifestModule);
        }
        if (pagesModule && rel.startsWith('pages/')) {
          server.moduleGraph.invalidateModule(pagesModule);
          modules.push(pagesModule);
        }

        if (modules.length > 0) {
          return modules;
        }
      }
      return undefined;
    },
  };
}

/**
 * Generate the virtual:amodal-manifest module.
 * Exports pages and automations config (stores come from the API at runtime).
 */
function generateManifestModule(repoPath: string): string {
  const pages = scanPages(repoPath);
  const automations = scanAutomations(repoPath);

  return `
export const pages = ${JSON.stringify(pages, null, 2)};
export const automations = ${JSON.stringify(automations, null, 2)};
`;
}

/**
 * Generate the virtual:amodal-pages module.
 * Re-exports each page component as a named export.
 */
function generatePagesModule(repoPath: string): string {
  const pagesDir = path.join(repoPath, 'pages');
  const files = listPageFiles(pagesDir);

  if (files.length === 0) {
    return 'export default {};';
  }

  const imports: string[] = [];
  const entries: string[] = [];

  for (const file of files) {
    const name = file.replace(/\.(jsx|tsx|js|ts)$/, '');
    const safeName = name.replace(/[^a-zA-Z0-9]/g, '_');
    const absPath = path.join(pagesDir, file);

    imports.push(`import ${safeName} from '${absPath}';`);
    entries.push(`  '${name}': ${safeName},`);
  }

  return `${imports.join('\n')}

export default {
${entries.join('\n')}
};
`;
}

/**
 * Scan pages/ for page files and extract their exported config.
 */
function scanPages(repoPath: string): PageConfig[] {
  const pagesDir = path.join(repoPath, 'pages');
  const files = listPageFiles(pagesDir);

  return files.map((file) => {
    const filePath = path.join(pagesDir, file);
    const content = readFileSync(filePath, 'utf-8');
    const name = file.replace(/\.(jsx|tsx|js|ts)$/, '');
    const config = extractPageConfig(content);

    return {
      name: config.name ?? name,
      icon: config.icon,
      description: config.description,
      context: config.context,
      hidden: config.hidden,
      filePath: file,
    };
  });
}

/**
 * Extract the `export const page = { ... }` config from a page file.
 * Uses regex — not a full AST parser — for speed.
 */
function extractPageConfig(content: string): Partial<PageConfig> {
  const match = content.match(/export\s+const\s+page\s*=\s*(\{[\s\S]*?\})\s*;?\s*$/m);
  if (!match) return {};

  try {
    // Simple eval-free parsing: replace single quotes with double, remove trailing commas
    const jsonish = match[1]
      .replace(/'/g, '"')
      .replace(/(\w+)\s*:/g, '"$1":')
      .replace(/,\s*}/g, '}')
      .replace(/,\s*]/g, ']');
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- Best-effort config extraction
    return JSON.parse(jsonish) as Partial<PageConfig>;
  } catch {
    return {};
  }
}

/**
 * Scan automations/ directory for automation definitions.
 */
function scanAutomations(repoPath: string): AutomationConfig[] {
  const autoDir = path.join(repoPath, 'automations');
  if (!existsSync(autoDir)) return [];

  const entries = readdirSync(autoDir, { withFileTypes: true });
  const files = entries.filter(
    (e) => e.isFile() && (e.name.endsWith('.json') || e.name.endsWith('.md')),
  );

  return files.map((f) => {
    const name = f.name.replace(/\.(json|md)$/, '');
    const content = readFileSync(path.join(autoDir, f.name), 'utf-8');

    if (f.name.endsWith('.json')) {
      try {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- Automation JSON
        const parsed = JSON.parse(content) as Record<string, unknown>;
        return {
          name,
          title: String(parsed['title'] ?? name),
          schedule: parsed['schedule'] ? String(parsed['schedule']) : undefined,
          trigger: parsed['schedule'] ? 'cron' : 'manual',
        };
      } catch {
        return { name, trigger: 'manual' };
      }
    }

    // Markdown automations — extract title from first heading
    const titleMatch = content.match(/^#\s+(.+)/m);
    return {
      name,
      title: titleMatch?.[1] ?? name,
      trigger: 'manual',
    };
  });
}

/**
 * List page files (jsx/tsx) in a directory.
 */
function listPageFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];

  return readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isFile() && /\.(jsx|tsx|js|ts)$/.test(e.name))
    .map((e) => e.name);
}
