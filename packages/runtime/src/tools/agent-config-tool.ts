/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

/**
 * read_agent_config tool — lets the admin agent see what's configured
 * in the user's agent (packages, models, etc.) without accessing the
 * raw amodal.json file which is in the blocked files list.
 */

import { readFileSync, existsSync, readdirSync } from 'node:fs';
import * as path from 'node:path';
import { z } from 'zod';
import type { ToolRegistry, ToolContext } from './types.js';

export function registerAgentConfigTool(registry: ToolRegistry, repoRoot: string): void {
  registry.register('read_agent_config', {
    description:
      'Read the current agent configuration: installed packages, connections, ' +
      'skills, knowledge, automations, and model settings. Use this to ' +
      'understand what the agent has before making changes.',
    parameters: z.object({}),
    readOnly: true,
    metadata: { category: 'admin' },

    async execute(_params: Record<string, never>, _ctx: ToolContext) {
      const configPath = path.join(repoRoot, 'amodal.json');
      if (!existsSync(configPath)) {
        return { error: 'No amodal.json found' };
      }

      try {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- parsing local JSON
        const config = JSON.parse(readFileSync(configPath, 'utf-8')) as Record<string, unknown>;

        // List directory contents for each config dir
        const dirs = ['skills', 'knowledge', 'connections', 'automations', 'stores', 'pages', 'evals', 'tools'];
        const contents: Record<string, string[]> = {};
        for (const dir of dirs) {
          const dirPath = path.join(repoRoot, dir);
          if (existsSync(dirPath)) {
            contents[dir] = readdirSync(dirPath).filter((f) => !f.startsWith('.'));
          }
        }

        // Read package metadata for installed connections
        const packages: Array<{ name: string; displayName: string; description?: string }> = [];
        const pkgList = Array.isArray(config['packages'])
          ? config['packages'].filter((p): p is string => typeof p === 'string')
          : [];
        for (const pkg of pkgList) {
          try {
            const pkgJsonPath = path.join(repoRoot, 'node_modules', pkg, 'package.json');
            if (!existsSync(pkgJsonPath)) continue;
            // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- parsing package.json
            const pkgJson = JSON.parse(readFileSync(pkgJsonPath, 'utf-8')) as Record<string, unknown>;
            // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- amodal block
            const amodal = pkgJson['amodal'] as Record<string, unknown> | undefined;
            packages.push({
              name: pkg,
              displayName: typeof amodal?.['displayName'] === 'string' ? amodal['displayName']
                : typeof amodal?.['name'] === 'string' ? amodal['name']
                : pkg,
              description: typeof amodal?.['description'] === 'string' ? amodal['description'] : undefined,
            });
          } catch { /* non-fatal — package may be missing or malformed */ }
        }

        return {
          name: config['name'],
          version: config['version'],
          packages,
          contents,
          models: config['models'],
          memory: config['memory'],
        };
      } catch (err: unknown) {
        return { error: err instanceof Error ? err.message : String(err) };
      }
    },
  });
}
