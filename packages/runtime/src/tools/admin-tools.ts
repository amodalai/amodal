/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

/**
 * Admin agent tools for the Onboarding v4 conversational setup flow.
 *
 * - `show_preview` — emits an inline `show_preview` SSE event with a curated
 *   template card.
 * - `ask_choice` — emits a button-row question; user's click posts the chosen
 *   value as the next user turn (no server round-trip needed).
 * - `search_packages` — searches the public npm registry for keyword matches
 *   (e.g. `keywords:amodal-connection`) and returns top-N hits.
 * - `install_package` — adds an npm package to `amodal.json#packages` and
 *   runs `npm install` in the agent repo.
 * - `write_skill` — scaffolds a `skills/<name>/SKILL.md` with frontmatter.
 *
 * These are gated by `sessionType === 'admin'` in the session builder.
 */

import {execFile} from 'node:child_process';
import {readFile, writeFile, mkdir} from 'node:fs/promises';
import * as path from 'node:path';
import {promisify} from 'node:util';
import {z} from 'zod';
import type {ToolRegistry, ToolContext} from './types.js';
import type {Logger} from '../logger.js';
import {SSEEventType} from '../types.js';

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
  // show_preview — inline template card snippet
  // -------------------------------------------------------------------------
  registry.register('show_preview', {
    description:
      'Show an agent card preview inline in chat. Use when recommending a template or showing what an agent will look like.',
    parameters: z.object({
      title: z.string().describe('Display title (e.g. "Monday Marketing Digest")'),
      tagline: z.string().describe('One-line "what it does" line under the title'),
      platforms: z.array(z.string()).default([]).describe('Connected services to surface as chips'),
      thumbnailConversation: z
        .array(
          z.object({
            role: z.enum(['user', 'agent']),
            content: z.string(),
          }),
        )
        .min(1)
        .describe('2-4 turn conversation snippet showing the agent in action'),
    }),
    readOnly: true,
    metadata: {category: 'admin'},

    async execute(
      params: {
        title: string;
        tagline: string;
        platforms: string[];
        thumbnailConversation: Array<{role: 'user' | 'agent'; content: string}>;
      },
      ctx: ToolContext,
    ) {
      ctx.emit?.({
        type: SSEEventType.ShowPreview,
        card: {
          title: params.title,
          tagline: params.tagline,
          platforms: params.platforms,
          thumbnailConversation: params.thumbnailConversation,
        },
        timestamp: new Date().toISOString(),
      });
      return {ok: true};
    },
  });

  // -------------------------------------------------------------------------
  // ask_choice — button-row single/multi-select question
  // -------------------------------------------------------------------------
  registry.register('ask_choice', {
    description:
      'Ask the user a single- or multi-select question with predefined options. Renders inline as buttons; the user\'s choice arrives as their next message.',
    parameters: z.object({
      question: z.string().describe('Short question shown above the buttons'),
      options: z
        .array(z.object({label: z.string(), value: z.string()}))
        .min(2)
        .describe('Choice options. `label` is shown on the button; `value` is what the user "says".'),
      multi: z
        .boolean()
        .default(false)
        .describe('When true, the user can pick more than one option before submitting'),
    }),
    readOnly: true,
    metadata: {category: 'admin'},

    async execute(
      params: {question: string; options: Array<{label: string; value: string}>; multi: boolean},
      ctx: ToolContext,
    ) {
      const askId = `choice_${ctx.sessionId}_${Date.now().toString(36)}`;
      ctx.emit?.({
        type: SSEEventType.AskChoice,
        ask_id: askId,
        question: params.question,
        options: params.options,
        multi: params.multi,
        timestamp: new Date().toISOString(),
      });
      return {ok: true, ask_id: askId};
    },
  });

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
  // start_oauth_connection — render an inline Connect button in chat
  // -------------------------------------------------------------------------
  registry.register('start_oauth_connection', {
    description:
      'Render an inline OAuth Connect button in the chat for an installed package. Use after the user agrees to connect a service (e.g. Slack, Google Analytics). The button opens the provider\'s authorize flow in a popup.',
    parameters: z.object({
      packageName: z.string().describe('npm package providing the connection (e.g. "@amodalai/connection-slack")'),
      displayName: z.string().optional().describe('Optional label for the button ("Connect Slack"). Defaults to package name.'),
    }),
    readOnly: true,
    metadata: {category: 'admin'},

    async execute(params: {packageName: string; displayName?: string}, ctx: ToolContext) {
      ctx.emit?.({
        type: SSEEventType.StartOAuth,
        package_name: params.packageName,
        ...(params.displayName ? {display_name: params.displayName} : {}),
        timestamp: new Date().toISOString(),
      });
      return {ok: true, package: params.packageName};
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
