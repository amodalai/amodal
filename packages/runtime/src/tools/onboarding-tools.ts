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
import type {SSEShowGalleryEvent, SSECollectSecretEvent, SSESetupConnectionsEvent, SSESetupSummaryEvent, SSECustomizeAgentEvent} from '../types.js';

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
            logger.debug('show_gallery_card_fetch_failed', {repo: t.repo, status: res.status});
            // Fallback: use repo name as the card title
            const repoName = t.repo.split('/').pop() ?? t.repo;
            const displayName = repoName.replace(/^template-/, '').replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
            templates.push({
              repo: t.repo,
              title: displayName,
              tagline: '',
              author: t.repo.split('/')[0] ?? 'unknown',
              verified: false,
            });
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
          logger.debug('show_gallery_card_error', {
            repo: t.repo,
            error: err instanceof Error ? err.message : String(err),
          });
          const repoName = t.repo.split('/').pop() ?? t.repo;
          const displayName = repoName.replace(/^template-/, '').replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
          templates.push({
            repo: t.repo,
            title: displayName,
            tagline: '',
            author: t.repo.split('/')[0] ?? 'unknown',
            verified: false,
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
// setup_connections
// ---------------------------------------------------------------------------

function registerSetupConnections(registry: ToolRegistry, opts: OnboardingToolsOptions): void {
  const {repoRoot, logger} = opts;

  registry.register('setup_connections', {
    description:
      'Show credential input cards for all connections in the agent. ' +
      'Reads connection packages from amodal.json and renders a card for each one. ' +
      'Use this after cloning a template to walk the user through connecting their accounts.',
    parameters: z.object({}),
    readOnly: true,
    metadata: {category: 'admin'},

    async execute(_params: Record<string, never>, ctx: ToolContext) {
      // Read amodal.json to find packages
      let packages: string[] = [];
      try {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- parsing local JSON
        const config = JSON.parse(await readFile(path.join(repoRoot, 'amodal.json'), 'utf-8')) as Record<string, unknown>;
        if (Array.isArray(config['packages'])) {
          packages = config['packages'].filter((p): p is string => typeof p === 'string');
        }
      } catch {
        return {error: 'Could not read agent configuration'};
      }

      // Read each package's auth metadata from node_modules
      const connections: SSESetupConnectionsEvent['connections'] = [];
      for (const pkg of packages) {
        try {
          const pkgJsonPath = path.join(repoRoot, 'node_modules', pkg, 'package.json');
          if (!existsSync(pkgJsonPath)) continue;
          // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- parsing package.json
          const pkgJson = JSON.parse(await readFile(pkgJsonPath, 'utf-8')) as Record<string, unknown>;
          // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- amodal metadata block
          const amodal = pkgJson['amodal'] as Record<string, unknown> | undefined;
          if (!amodal) continue;

          const displayName = typeof amodal['displayName'] === 'string' ? amodal['displayName']
            : typeof amodal['name'] === 'string' ? amodal['name']
            : pkg.split('/').pop() ?? pkg;

          // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- auth block
          const auth = amodal['auth'] as Record<string, unknown> | undefined;
          if (!auth?.['envVars']) continue;

          // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- envVars record
          const envVars = auth['envVars'] as Record<string, string>;
          for (const [envVar, description] of Object.entries(envVars)) {
            const isSet = !!process.env[envVar];
            connections.push({
              name: displayName,
              label: envVar,
              auth_type: 'api_key',
              env_var: envVar,
              description,
              status: isSet ? 'connected' : 'pending',
            });
          }
        } catch (err: unknown) {
          logger.debug('setup_connections_pkg_error', {pkg, error: err instanceof Error ? err.message : String(err)});
        }
      }

      if (connections.length === 0) {
        return {connections: 0, message: 'No connections require credentials'};
      }

      const event: SSESetupConnectionsEvent = {
        type: SSEEventType.SetupConnections,
        connections,
        timestamp: new Date().toISOString(),
      };

      ctx.emit?.(event);

      const pending = connections.filter((c) => c.status === 'pending').length;
      const connected = connections.filter((c) => c.status === 'connected').length;
      return {connections: connections.length, pending, connected};
    },
  });
}

// ---------------------------------------------------------------------------
// customize_agent
// ---------------------------------------------------------------------------

function registerCustomizeAgent(registry: ToolRegistry, _opts: OnboardingToolsOptions): void {

  registry.register('customize_agent', {
    description:
      'Ask the user about their company/brand so the agent can generate relevant content. ' +
      'Renders input fields for website URL and a brief description. ' +
      'Writes a brand-context knowledge doc to the agent repo. ' +
      'Use this after setting up connections.',
    parameters: z.object({}),
    readOnly: true,
    metadata: {category: 'admin'},

    async execute(_params: Record<string, never>, ctx: ToolContext) {
      const event: SSECustomizeAgentEvent = {
        type: SSEEventType.CustomizeAgent,
        prompts: [
          {
            id: 'website',
            label: 'Your website or company URL',
            placeholder: 'https://example.com',
            required: false,
          },
          {
            id: 'description',
            label: 'What does your company do? (1-2 sentences)',
            placeholder: 'We build developer tools for...',
            required: false,
          },
        ],
        skip_label: 'Skip for now — I\'ll customize later',
        timestamp: new Date().toISOString(),
      };

      ctx.emit?.(event);

      // The widget handles the form submission. When the user submits,
      // it sends the values as a chat message. The agent then calls
      // write_knowledge or write_repo_file to create the brand context doc.
      // When the user skips, the widget sends "Skip customization" as a message.
      return {ok: true, message: 'Waiting for user input'};
    },
  });
}

// ---------------------------------------------------------------------------
// show_setup_summary
// ---------------------------------------------------------------------------

function registerShowSetupSummary(registry: ToolRegistry, opts: OnboardingToolsOptions): void {
  const {repoRoot} = opts;

  registry.register('show_setup_summary', {
    description:
      'Show a summary card of the agent setup: what\'s connected, what\'s pending, ' +
      'and a link to start using the agent. Use this as the final step of onboarding.',
    parameters: z.object({
      agent_url: z.string().describe('URL to the agent runtime (e.g. http://localhost:6847)'),
    }),
    readOnly: true,
    metadata: {category: 'admin'},

    async execute(params: {agent_url: string}, ctx: ToolContext) {
      // Read current state
      let agentName = 'Your agent';
      let packages: string[] = [];
      let skills: string[] = [];
      try {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- parsing local JSON
        const config = JSON.parse(await readFile(path.join(repoRoot, 'amodal.json'), 'utf-8')) as Record<string, unknown>;
        if (typeof config['name'] === 'string') agentName = config['name'];
        if (Array.isArray(config['packages'])) {
          packages = config['packages'].filter((p): p is string => typeof p === 'string');
        }
      } catch { /* non-fatal */ }

      try {
        if (existsSync(path.join(repoRoot, 'skills'))) {
          skills = await readdir(path.join(repoRoot, 'skills'));
        }
      } catch { /* non-fatal */ }

      // Check connection status
      const connections: SSESetupSummaryEvent['connections'] = [];
      for (const pkg of packages) {
        try {
          const pkgJsonPath = path.join(repoRoot, 'node_modules', pkg, 'package.json');
          if (!existsSync(pkgJsonPath)) continue;
          // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- parsing package.json
          const pkgJson = JSON.parse(await readFile(pkgJsonPath, 'utf-8')) as Record<string, unknown>;
          // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- amodal block
          const amodal = pkgJson['amodal'] as Record<string, unknown> | undefined;
          if (!amodal) continue;

          const name = typeof amodal['displayName'] === 'string' ? amodal['displayName']
            : typeof amodal['name'] === 'string' ? amodal['name']
            : pkg.split('/').pop() ?? pkg;

          // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- auth block
          const auth = amodal['auth'] as Record<string, unknown> | undefined;
          // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- envVars
          const envVars = (auth?.['envVars'] ?? {}) as Record<string, string>;
          const allSet = Object.keys(envVars).every((k) => !!process.env[k]);
          connections.push({
            name,
            status: Object.keys(envVars).length === 0 ? 'connected' : allSet ? 'connected' : 'pending',
          });
        } catch { /* skip */ }
      }

      const event: SSESetupSummaryEvent = {
        type: SSEEventType.SetupSummary,
        agent_name: agentName,
        connections,
        skills,
        agent_url: params.agent_url,
        timestamp: new Date().toISOString(),
      };

      ctx.emit?.(event);

      return {
        agent_name: agentName,
        connected: connections.filter((c) => c.status === 'connected').length,
        pending: connections.filter((c) => c.status === 'pending').length,
        skills: skills.length,
      };
    },
  });
}

// ---------------------------------------------------------------------------
// onboarding_step — stateful flow controller
// ---------------------------------------------------------------------------

type OnboardingStepName = 'gallery' | 'clone' | 'connections' | 'customize' | 'summary' | 'done';

interface OnboardingState {
  step: OnboardingStepName;
  selectedTemplate?: string;
}

const sessionStates = new Map<string, OnboardingState>();

function registerOnboardingStep(registry: ToolRegistry, opts: OnboardingToolsOptions): void {
  const {repoRoot, logger} = opts;

  // Template catalog — same repos the show_gallery tool uses
  const TEMPLATES = [
    {repo: 'amodalai/template-content-marketing', branch: 'main'},
    {repo: 'amodalai/template-support-triage', branch: 'main'},
    {repo: 'amodalai/template-sales-pipeline', branch: 'main'},
  ];

  registry.register('onboarding_step', {
    description:
      'Advance the onboarding flow to the next step. Call this tool repeatedly — ' +
      'it tracks progress and emits the right UI for each step. ' +
      'Pass user_input with the user\'s choice or response from the previous step.',
    parameters: z.object({
      user_input: z.string().optional().describe('The user\'s response to the previous step (e.g. template name, "skip", form data)'),
    }),
    readOnly: false,
    metadata: {category: 'admin'},

    async execute(params: {user_input?: string}, ctx: ToolContext) {
      const state = sessionStates.get(ctx.sessionId) ?? {step: 'gallery' as OnboardingStepName};

      switch (state.step) {
        // ----- GALLERY -----
        case 'gallery': {
          const templates: SSEShowGalleryEvent['templates'] = [];
          for (const t of TEMPLATES) {
            try {
              const cardUrl = `https://raw.githubusercontent.com/${t.repo}/${t.branch}/card/card.json`;
              const res = await fetch(cardUrl, {signal: AbortSignal.timeout(CARD_FETCH_TIMEOUT_MS)});
              // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- parsing external JSON
              const card = res.ok ? await res.json() as Record<string, unknown> : {};
              templates.push({
                repo: t.repo,
                title: typeof card['title'] === 'string' ? card['title'] : t.repo.split('/').pop()?.replace(/^template-/, '').replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()) ?? t.repo,
                tagline: typeof card['tagline'] === 'string' ? card['tagline'] : '',
                author: typeof card['author'] === 'string' ? card['author'] : 'unknown',
                verified: card['verified'] === true,
              });
            } catch {
              const name = t.repo.split('/').pop()?.replace(/^template-/, '').replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()) ?? t.repo;
              templates.push({repo: t.repo, title: name, tagline: '', author: 'unknown', verified: false});
            }
          }

          ctx.emit?.({
            type: SSEEventType.ShowGallery,
            title: 'Start with an agent',
            templates,
            allow_custom: true,
            timestamp: new Date().toISOString(),
          });

          state.step = 'clone';
          sessionStates.set(ctx.sessionId, state);
          return {step: 'gallery', wait_for_user: true, say: 'Pick a template or describe what you need.'};
        }

        // ----- CLONE -----
        case 'clone': {
          const input = params.user_input ?? '';
          const template = TEMPLATES.find((t) => input.toLowerCase().includes(t.repo.split('/').pop()?.replace(/^template-/, '').replace(/-/g, ' ') ?? ''));
          if (!template) {
            // Custom build — skip to done, let agent handle conversationally
            state.step = 'done';
            sessionStates.set(ctx.sessionId, state);
            return {step: 'custom', message: 'User wants a custom agent. Help them with search_packages and install_package.'};
          }

          // Validate and clone
          if (!/^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/.test(template.repo)) {
            return {step: 'clone', error: 'Invalid repo format'};
          }
          const tmpDir = path.join(repoRoot, '.amodal', '.tmp-clone');
          try {
            if (existsSync(tmpDir)) await rm(tmpDir, {recursive: true, force: true});
            await mkdir(tmpDir, {recursive: true});
            await execFileAsync('git', ['clone', '--depth', '1', '--branch', template.branch, '--', `https://github.com/${template.repo}.git`, tmpDir], {timeout: CLONE_TIMEOUT_MS});
            await rm(path.join(tmpDir, '.git'), {recursive: true, force: true});
            const entries = await readdir(tmpDir);
            for (const entry of entries) {
              if (entry === 'card' || entry === '.git') continue;
              const dst = path.join(repoRoot, entry);
              if (existsSync(dst)) continue;
              await cp(path.join(tmpDir, entry), dst, {recursive: true});
            }
            await mergeAmodalJson(repoRoot, tmpDir, logger);
            await rm(tmpDir, {recursive: true, force: true});

            // Install npm packages so connection metadata is available
            await execFileAsync('npm', ['install', '--no-audit', '--no-fund'], {cwd: repoRoot, timeout: 120_000});
            logger.info('template_packages_installed', {repoRoot});
          } catch (err: unknown) {
            await rm(tmpDir, {recursive: true, force: true}).catch(() => {});
            return {step: 'clone', error: err instanceof Error ? err.message : String(err)};
          }

          state.selectedTemplate = template.repo;
          state.step = 'connections';
          sessionStates.set(ctx.sessionId, state);
          return {step: 'cloned', repo: template.repo, say: 'Template installed. Setting up connections now.', call_again: true};
        }

        // ----- CONNECTIONS -----
        case 'connections': {
          let packages: string[] = [];
          try {
            // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- parsing local JSON
            const config = JSON.parse(await readFile(path.join(repoRoot, 'amodal.json'), 'utf-8')) as Record<string, unknown>;
            if (Array.isArray(config['packages'])) packages = config['packages'].filter((p): p is string => typeof p === 'string');
          } catch { /* */ }

          const connections: SSESetupConnectionsEvent['connections'] = [];
          for (const pkg of packages) {
            try {
              const pkgJsonPath = path.join(repoRoot, 'node_modules', pkg, 'package.json');
              if (!existsSync(pkgJsonPath)) continue;
              // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- parsing package.json
              const pkgJson = JSON.parse(await readFile(pkgJsonPath, 'utf-8')) as Record<string, unknown>;
              // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- amodal block
              const amodal = pkgJson['amodal'] as Record<string, unknown> | undefined;
              if (!amodal?.['auth']) continue;
              // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- auth block
              const auth = amodal['auth'] as Record<string, unknown>;
              // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- envVars
              const envVars = (auth['envVars'] ?? {}) as Record<string, string>;
              const displayName = typeof amodal['displayName'] === 'string' ? amodal['displayName'] : typeof amodal['name'] === 'string' ? amodal['name'] : pkg.split('/').pop() ?? pkg;
              for (const [envVar, description] of Object.entries(envVars)) {
                connections.push({name: displayName, label: envVar, auth_type: 'api_key', env_var: envVar, description, status: process.env[envVar] ? 'connected' : 'pending'});
              }
            } catch { /* skip */ }
          }

          if (connections.length > 0) {
            ctx.emit?.({type: SSEEventType.SetupConnections, connections, timestamp: new Date().toISOString()});
          }

          state.step = 'customize';
          sessionStates.set(ctx.sessionId, state);
          return {step: 'connections', count: connections.length, wait_for_user: true, say: connections.length > 0 ? 'Fill in your API keys above, then click Continue.' : 'No credentials needed — moving on.'};
        }

        // ----- CUSTOMIZE -----
        case 'customize': {
          ctx.emit?.({
            type: SSEEventType.CustomizeAgent,
            prompts: [
              {id: 'website', label: 'Your website or company URL', placeholder: 'https://example.com', required: false},
              {id: 'description', label: 'What does your company do? (1-2 sentences)', placeholder: 'We build developer tools for...', required: false},
            ],
            skip_label: 'Skip for now',
            timestamp: new Date().toISOString(),
          });

          state.step = 'summary';
          sessionStates.set(ctx.sessionId, state);
          return {step: 'customize', wait_for_user: true, say: 'Tell me about your company so I can personalize your agent.'};
        }

        // ----- SUMMARY -----
        case 'summary': {
          let agentName = 'Your agent';
          let packages: string[] = [];
          let skills: string[] = [];
          try {
            // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- parsing local JSON
            const config = JSON.parse(await readFile(path.join(repoRoot, 'amodal.json'), 'utf-8')) as Record<string, unknown>;
            if (typeof config['name'] === 'string') agentName = config['name'];
            if (Array.isArray(config['packages'])) packages = config['packages'].filter((p): p is string => typeof p === 'string');
          } catch { /* */ }
          try {
            if (existsSync(path.join(repoRoot, 'skills'))) skills = await readdir(path.join(repoRoot, 'skills'));
          } catch { /* */ }

          const connections: SSESetupSummaryEvent['connections'] = [];
          for (const pkg of packages) {
            try {
              const pkgJsonPath = path.join(repoRoot, 'node_modules', pkg, 'package.json');
              if (!existsSync(pkgJsonPath)) continue;
              // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- parsing package.json
              const pkgJson = JSON.parse(await readFile(pkgJsonPath, 'utf-8')) as Record<string, unknown>;
              // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- amodal block
              const amodal = pkgJson['amodal'] as Record<string, unknown> | undefined;
              if (!amodal) continue;
              const name = typeof amodal['displayName'] === 'string' ? amodal['displayName'] : typeof amodal['name'] === 'string' ? amodal['name'] : pkg.split('/').pop() ?? pkg;
              // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- auth block
              const auth = (amodal['auth'] ?? {}) as Record<string, unknown>;
              // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- envVars
              const envVars = (auth['envVars'] ?? {}) as Record<string, string>;
              const allSet = Object.keys(envVars).every((k) => !!process.env[k]);
              connections.push({name, status: Object.keys(envVars).length === 0 ? 'connected' : allSet ? 'connected' : 'pending'});
            } catch { /* skip */ }
          }

          // Determine runtime URL from env
          const runtimePort = process.env['PORT'] ?? '3847';
          const agentUrl = `http://localhost:${runtimePort}`;

          ctx.emit?.({
            type: SSEEventType.SetupSummary,
            agent_name: agentName,
            connections,
            skills,
            agent_url: agentUrl,
            timestamp: new Date().toISOString(),
          });

          state.step = 'done';
          sessionStates.set(ctx.sessionId, state);
          return {step: 'summary', done: true};
        }

        case 'done':
          return {step: 'done', message: 'Onboarding is complete. Help the user with any customization requests.'};

        default:
          return {step: 'unknown', error: 'Unknown onboarding state'};
      }
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
  registerSetupConnections(registry, opts);
  registerCustomizeAgent(registry, opts);
  registerShowSetupSummary(registry, opts);
  registerOnboardingStep(registry, opts);
}
