/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

/**
 * Admin agent tools for the Onboarding v4 conversational setup flow.
 *
 * - `search_packages` — searches the public npm registry for keyword matches
 *   (e.g. `keywords:amodal-connection`) and returns top-N hits.
 * - `install_package` — adds an npm package to `amodal.json#packages` and
 *   runs `npm install` in the agent repo.
 * - `write_skill` — scaffolds a `skills/<name>/SKILL.md` with frontmatter.
 *
 * `start_oauth_connection` was removed in Phase H.1; replaced by the
 * `present_connection` custom tool in agent-admin, which emits a
 * `connection_panel` block via `ctx.emit` (auth-agnostic).
 *
 * These are gated by `sessionType === 'admin'` in the session builder.
 *
 * `show_preview` migrated to `@amodalai/agent-admin/tools/show_preview/`
 * in Phase 0.6 — it is auto-discovered via the package's own tools
 * directory, not hardcoded here.
 *
 * `ask_choice` was promoted to a runtime built-in in Phase 0.6 — see
 * `tools/builtin/ask-choice.ts`. Every agent gets it, not just admin.
 */

import {execFile} from 'node:child_process';
import {readFile, writeFile, mkdir} from 'node:fs/promises';
import * as path from 'node:path';
import {promisify} from 'node:util';
import {z} from 'zod';
import type {ToolRegistry, ToolContext} from './types.js';
import type {Logger} from '../logger.js';

const execFileAsync = promisify(execFile);

const NPM_SEARCH_TIMEOUT_MS = 10_000;
const NPM_INSTALL_TIMEOUT_MS = 120_000;
const DEFAULT_SEARCH_LIMIT = 10;
const DEFAULT_NPM_REGISTRY = 'https://registry.npmjs.org';

export interface AdminToolsOptions {
  /** Path to the agent repo — `install_package` writes amodal.json here. */
  repoRoot: string;
  /** npm registry base URL. Defaults to npmjs.org; tests override. */
  registryUrl?: string;
  logger: Logger;
}

export function registerAdminTools(registry: ToolRegistry, opts: AdminToolsOptions): void {
  const {repoRoot, logger} = opts;
  const registryUrl = opts.registryUrl ?? DEFAULT_NPM_REGISTRY;

  // -------------------------------------------------------------------------
  // search_packages — keyword-based npm registry search
  // -------------------------------------------------------------------------
  registry.register('search_packages', {
    description:
      'Search the npm registry for amodal connection / skill / template packages. Use keyword:amodal-connection, keyword:amodal-skill, etc.',
    parameters: z.object({
      query: z.string().describe('Search query (keywords + free text). Example: "keywords:amodal-connection slack".'),
      limit: z.number().int().min(1).max(50).default(DEFAULT_SEARCH_LIMIT),
    }),
    readOnly: true,
    metadata: {category: 'admin'},

    async execute(params: {query: string; limit: number}, _ctx: ToolContext) {
      const url = `${registryUrl}/-/v1/search?text=${encodeURIComponent(params.query)}&size=${String(params.limit)}`;
      logger.debug('admin_tool_search_packages', {query: params.query, limit: params.limit});
      try {
        const res = await fetch(url, {signal: AbortSignal.timeout(NPM_SEARCH_TIMEOUT_MS)});
        if (!res.ok) {
          return {error: `npm search returned ${String(res.status)}`};
        }
        const raw: unknown = await res.json();
        return {results: extractSearchHits(raw)};
      } catch (err) {
        return {error: err instanceof Error ? err.message : 'npm search failed'};
      }
    },
  });

  // -------------------------------------------------------------------------
  // install_package — add to amodal.json#packages and npm install
  // -------------------------------------------------------------------------
  registry.register('install_package', {
    description:
      'Install an npm package into the agent repo. Adds the package to amodal.json#packages and runs `npm install`. Use after the user confirms.',
    parameters: z.object({
      name: z.string().describe('Package name (e.g. "@amodalai/connection-slack")'),
      version: z.string().optional().describe('Optional version range; defaults to "latest"'),
    }),
    readOnly: false,
    metadata: {category: 'admin'},

    async execute(params: {name: string; version?: string}, ctx: ToolContext) {
      const versionSpec = params.version && params.version !== '' ? `${params.name}@${params.version}` : `${params.name}@latest`;
      logger.debug('admin_tool_install_package', {name: params.name, version: params.version});

      try {
        await addToAmodalPackages(repoRoot, params.name);
        await execFileAsync('npm', ['install', versionSpec], {
          cwd: repoRoot,
          timeout: NPM_INSTALL_TIMEOUT_MS,
        });
        ctx.log(`Installed ${versionSpec}`);
        return {ok: true, package: params.name};
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        logger.warn('admin_tool_install_package_failed', {name: params.name, error: message});
        return {error: `Failed to install ${params.name}: ${message}`};
      }
    },
  });

  // -------------------------------------------------------------------------
  // write_skill — scaffold a skills/<name>/SKILL.md
  // -------------------------------------------------------------------------
  registry.register('write_skill', {
    description:
      'Scaffold a new SKILL.md at skills/<name>/SKILL.md. Use when no published skill package fits and you need to write a custom skill for the user.',
    parameters: z.object({
      name: z.string().regex(/^[a-z][a-z0-9-]*$/, 'kebab-case').describe('Skill name (kebab-case)'),
      description: z.string().describe('One-line skill description'),
      trigger: z.string().describe('When the agent should activate this skill'),
      methodology: z.string().describe('Markdown body — the steps the agent should take'),
    }),
    readOnly: false,
    metadata: {category: 'admin'},

    async execute(
      params: {name: string; description: string; trigger: string; methodology: string},
      _ctx: ToolContext,
    ) {
      const skillDir = path.join(repoRoot, 'skills', params.name);
      const skillPath = path.join(skillDir, 'SKILL.md');
      const body = renderSkillBody(params);
      try {
        await mkdir(skillDir, {recursive: true});
        await writeFile(skillPath, body, 'utf-8');
        return {ok: true, path: path.relative(repoRoot, skillPath)};
      } catch (err) {
        return {error: err instanceof Error ? err.message : 'write_skill failed'};
      }
    },
  });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface SearchHit {
  name: string;
  version: string;
  description: string;
  keywords: string[];
}

/**
 * Pull the relevant fields from npm's `/-/v1/search` response. The response
 * shape is `{ objects: [{ package: { name, version, description, keywords } }] }`.
 */
export function extractSearchHits(raw: unknown): SearchHit[] {
  if (typeof raw !== 'object' || raw === null) return [];
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- system boundary: parsing npm registry JSON
  const obj = raw as Record<string, unknown>;
  const objects = obj['objects'];
  if (!Array.isArray(objects)) return [];
  const hits: SearchHit[] = [];
  for (const entry of objects) {
    if (typeof entry !== 'object' || entry === null) continue;
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- system boundary: parsing npm registry JSON
    const pkg = (entry as Record<string, unknown>)['package'];
    if (typeof pkg !== 'object' || pkg === null) continue;
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- system boundary: parsing npm registry JSON
    const p = pkg as Record<string, unknown>;
    const name = p['name'];
    if (typeof name !== 'string') continue;
    const version = p['version'];
    const description = p['description'];
    const keywords = p['keywords'];
    hits.push({
      name,
      version: typeof version === 'string' ? version : '',
      description: typeof description === 'string' ? description : '',
      keywords: Array.isArray(keywords)
        ? keywords.filter((k): k is string => typeof k === 'string')
        : [],
    });
  }
  return hits;
}

/**
 * Add `name` to `amodal.json#packages` if absent. Idempotent.
 * Throws when `amodal.json` is missing — the admin agent should fix that first.
 */
async function addToAmodalPackages(repoRoot: string, name: string): Promise<void> {
  const configPath = path.join(repoRoot, 'amodal.json');
  const raw = await readFile(configPath, 'utf-8');
  const parsed: unknown = JSON.parse(raw);
  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error('amodal.json is not an object');
  }
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- guarded above
  const config = parsed as Record<string, unknown>;
  const existingRaw = config['packages'];
  const existing = Array.isArray(existingRaw)
    ? existingRaw.filter((p): p is string => typeof p === 'string')
    : [];
  if (existing.includes(name)) return;
  config['packages'] = [...existing, name];
  await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, 'utf-8');
}

function renderSkillBody(params: {
  name: string;
  description: string;
  trigger: string;
  methodology: string;
}): string {
  return [
    `# ${params.description}`,
    '',
    `**Trigger:** ${params.trigger}`,
    '',
    '## Methodology',
    '',
    params.methodology.trim(),
    '',
  ].join('\n');
}
