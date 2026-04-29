/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

/**
 * Onboarding tools for the admin agent.
 *
 * Three tools that the onboarding skill uses to walk new users through
 * agent setup:
 *   - show_gallery: renders a grid of template cards in the chat
 *   - clone_template: copies a template repo into the user's project
 *   - collect_secret: renders an API key input form in the chat
 */

import {execFile} from 'node:child_process';
import {readdir, readFile, writeFile, mkdir, cp, rm} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import * as path from 'node:path';
import {promisify} from 'node:util';
import {z} from 'zod';
import type {ToolRegistry, ToolContext} from './types.js';
import type {Logger} from '../logger.js';
import {SSEEventType} from '../types.js';
import type {SSEShowGalleryEvent, SSECollectSecretEvent} from '../types.js';

const execFileAsync = promisify(execFile);

const CARD_FETCH_TIMEOUT_MS = 5_000;
const CLONE_TIMEOUT_MS = 30_000;

export interface OnboardingToolsOptions {
  repoRoot: string;
  logger: Logger;
}

// ---------------------------------------------------------------------------
// show_gallery
// ---------------------------------------------------------------------------

function registerShowGallery(registry: ToolRegistry, opts: OnboardingToolsOptions): void {
  const {logger} = opts;

  registry.register('show_gallery', {
    description:
      'Show a gallery of agent templates for the user to pick from. ' +
      'Use this when the user has a fresh repo and needs to choose a starting point.',
    parameters: z.object({
      templates: z.array(z.object({
        repo: z.string().describe('GitHub org/repo (e.g. "amodalai/template-content-marketing")'),
        branch: z.string().default('main'),
      })),
      title: z.string().default('Start with an agent'),
      allow_custom: z.boolean().default(true),
    }),
    readOnly: true,
    metadata: {category: 'admin'},

    async execute(params: {templates: Array<{repo: string; branch: string}>; title: string; allow_custom: boolean}, ctx: ToolContext) {
      const templates: SSEShowGalleryEvent['templates'] = [];

      for (const t of params.templates) {
        try {
          const cardUrl = `https://raw.githubusercontent.com/${t.repo}/${t.branch}/card/card.json`;
          const res = await fetch(cardUrl, {signal: AbortSignal.timeout(CARD_FETCH_TIMEOUT_MS)});
          if (!res.ok) {
            logger.warn('show_gallery_card_fetch_failed', {repo: t.repo, status: res.status});
            continue;
          }
          // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- parsing external JSON
          const card = await res.json() as Record<string, unknown>;
          templates.push({
            repo: t.repo,
            title: typeof card['title'] === 'string' ? card['title'] : t.repo,
            tagline: typeof card['tagline'] === 'string' ? card['tagline'] : '',
            author: typeof card['author'] === 'string' ? card['author'] : 'unknown',
            verified: card['verified'] === true,
          });
        } catch (err: unknown) {
          logger.warn('show_gallery_card_error', {
            repo: t.repo,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }

      const event: SSEShowGalleryEvent = {
        type: SSEEventType.ShowGallery,
        title: params.title,
        templates,
        allow_custom: params.allow_custom,
        timestamp: new Date().toISOString(),
      };

      ctx.emit?.(event);

      return {
        shown: templates.length,
        templates: templates.map((t) => ({repo: t.repo, title: t.title, tagline: t.tagline})),
      };
    },
  });
}

// ---------------------------------------------------------------------------
// clone_template
// ---------------------------------------------------------------------------

function registerCloneTemplate(registry: ToolRegistry, opts: OnboardingToolsOptions): void {
  const {repoRoot, logger} = opts;

  registry.register('clone_template', {
    description:
      'Clone a template repo into the current project. Use after the user picks a template from the gallery.',
    parameters: z.object({
      repo: z.string().describe('GitHub org/repo (e.g. "amodalai/template-content-marketing")'),
      branch: z.string().default('main'),
    }),
    readOnly: false,
    metadata: {category: 'admin'},

    async execute(params: {repo: string; branch: string}) {
      // Validate repo format to prevent command injection via --upload-pack
      if (!/^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/.test(params.repo)) {
        return {cloned: false, error: `Invalid repo format: ${params.repo}. Expected "owner/repo".`};
      }
      if (!/^[a-zA-Z0-9_.-]+$/.test(params.branch)) {
        return {cloned: false, error: `Invalid branch format: ${params.branch}.`};
      }

      const tmpDir = path.join(repoRoot, '.amodal', '.tmp-clone');

      try {
        if (existsSync(tmpDir)) await rm(tmpDir, {recursive: true, force: true});
        await mkdir(tmpDir, {recursive: true});

        const repoUrl = `https://github.com/${params.repo}.git`;
        await execFileAsync('git', [
          'clone', '--depth', '1', '--branch', params.branch,
          '--', repoUrl, tmpDir,
        ], {timeout: CLONE_TIMEOUT_MS});

        await rm(path.join(tmpDir, '.git'), {recursive: true, force: true});

        // Copy template contents, skipping card/ and files that already
        // exist (preserves user's .env, .gitignore from amodal init)
        const entries = await readdir(tmpDir);
        for (const entry of entries) {
          if (entry === 'card' || entry === '.git') continue;
          const src = path.join(tmpDir, entry);
          const dst = path.join(repoRoot, entry);
          if (existsSync(dst)) {
            logger.debug('clone_template_skip_existing', {entry});
            continue;
          }
          await cp(src, dst, {recursive: true});
        }

        // Merge amodal.json: template's packages + settings, user's model config
        await mergeAmodalJson(repoRoot, tmpDir, logger);

        await rm(tmpDir, {recursive: true, force: true});

        // Discover what was cloned so the agent knows what credential
        // steps to walk through next
        const connections = existsSync(path.join(repoRoot, 'connections'))
          ? await readdir(path.join(repoRoot, 'connections'))
          : [];
        const skills = existsSync(path.join(repoRoot, 'skills'))
          ? await readdir(path.join(repoRoot, 'skills'))
          : [];

        let packages: string[] = [];
        try {
          // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- parsing local JSON
          const config = JSON.parse(await readFile(path.join(repoRoot, 'amodal.json'), 'utf-8')) as Record<string, unknown>;
          if (Array.isArray(config['packages'])) {
            packages = config['packages'].filter((p): p is string => typeof p === 'string');
          }
        } catch {
          // non-fatal — amodal.json might not exist yet
        }

        logger.info('template_cloned', {
          repo: params.repo,
          connections: connections.length,
          skills: skills.length,
          packages: packages.length,
        });

        return {cloned: true, repo: params.repo, connections, skills, packages};
      } catch (err: unknown) {
        await rm(tmpDir, {recursive: true, force: true}).catch(() => {});
        const message = err instanceof Error ? err.message : String(err);
        logger.warn('clone_template_failed', {repo: params.repo, error: message});
        return {cloned: false, error: message};
      }
    },
  });
}

async function mergeAmodalJson(repoRoot: string, tmpDir: string, logger: Logger): Promise<void> {
  const userPath = path.join(repoRoot, 'amodal.json');
  const templatePath = path.join(tmpDir, 'amodal.json');

  if (!existsSync(templatePath)) return;

  let userConfig: Record<string, unknown> = {};
  try {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- parsing local JSON
    userConfig = JSON.parse(await readFile(userPath, 'utf-8')) as Record<string, unknown>;
  } catch {
    // fresh init, minimal config
  }

  let templateConfig: Record<string, unknown>;
  try {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- parsing local JSON
    templateConfig = JSON.parse(await readFile(templatePath, 'utf-8')) as Record<string, unknown>;
  } catch {
    logger.warn('merge_amodal_json_parse_failed', {path: templatePath});
    return;
  }

  const merged = {
    ...templateConfig,
    name: userConfig['name'] ?? templateConfig['name'],
    version: userConfig['version'] ?? templateConfig['version'],
    ...(userConfig['models'] ? {models: userConfig['models']} : {}),
  };

  await writeFile(userPath, JSON.stringify(merged, null, 2) + '\n');
}

// ---------------------------------------------------------------------------
// collect_secret
// ---------------------------------------------------------------------------

function registerCollectSecret(registry: ToolRegistry, _opts: OnboardingToolsOptions): void {
  registry.register('collect_secret', {
    description:
      'Show an inline form for the user to enter an API key or secret. ' +
      'The value is saved securely and never sent to the chat. ' +
      'Use this for connections that need API keys (not OAuth).',
    parameters: z.object({
      name: z.string().describe('Environment variable name (e.g. SENDGRID_API_KEY)'),
      label: z.string().describe('Human-readable label for the input'),
      description: z.string().optional().describe('Help text about where to find the key'),
      link: z.string().optional().describe('URL to the provider dashboard where the key is found'),
      required: z.boolean().default(true),
    }),
    readOnly: true,
    metadata: {category: 'admin'},

    async execute(params: {name: string; label: string; description?: string; link?: string; required: boolean}, ctx: ToolContext) {
      const secretId = `secret_${ctx.sessionId}_${Date.now().toString(36)}`;

      const event: SSECollectSecretEvent = {
        type: SSEEventType.CollectSecret,
        secret_id: secretId,
        name: params.name,
        label: params.label,
        description: params.description,
        link: params.link,
        required: params.required,
        timestamp: new Date().toISOString(),
      };

      ctx.emit?.(event);

      return {ok: true, secret_id: secretId, name: params.name};
    },
  });
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

export function registerOnboardingTools(registry: ToolRegistry, opts: OnboardingToolsOptions): void {
  registerShowGallery(registry, opts);
  registerCloneTemplate(registry, opts);
  registerCollectSecret(registry, opts);
}
