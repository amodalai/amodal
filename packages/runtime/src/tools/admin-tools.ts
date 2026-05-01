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
import {existsSync} from 'node:fs';
import {readFile, writeFile, mkdir, mkdtemp, cp, rm} from 'node:fs/promises';
// eslint-disable-next-line no-restricted-imports -- install_template needs a system temp dir to clone into and ~/.npm/_logs to surface install failures; no @amodalai/core helper exists yet
import * as os from 'node:os';
import * as path from 'node:path';
import {promisify} from 'node:util';
import {z} from 'zod';
import {composePlan} from '@amodalai/core';
import type {ToolRegistry, ToolContext} from './types.js';
import type {Logger} from '../logger.js';
import {SSEEventType} from '../types.js';
import type {SSEPlanSummaryEvent} from '../types.js';

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
    runningLabel: 'Searching for "{{query}}"',
    completedLabel: 'Searched for "{{query}}"',

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
      'Install a CONNECTION or SKILL npm package into the agent repo (e.g. `@amodalai/connection-slack`). **For templates, use `install_template({slug})` instead — install_package will reject template-shaped names.** Accepts npm names (scoped or unscoped) and npm GitHub shorthand (`<owner>/<repo>`). Adds the resolved package to amodal.json#packages and runs `npm install`. Returns `{ok: true, package: <resolved-npm-name>}` on success.',
    parameters: z.object({
      name: z.string().describe('npm package name OR GitHub `<owner>/<repo>` shorthand'),
      version: z.string().optional().describe('Optional version range; ignored for GitHub installs'),
    }),
    readOnly: false,
    metadata: {category: 'admin'},
    runningLabel: 'Adding a package',
    completedLabel: 'Added the package',

    async execute(params: {name: string; version?: string}, ctx: ToolContext) {
      // Hard guardrail: templates are installed via `install_template`,
      // not via `install_package`. The model has strong training
      // priors for `@amodalai/template-*` npm names that don't actually
      // exist on the registry — block them here and redirect with an
      // educational error rather than letting npm 404 over and over.
      if (/^@?[\w./-]*template-/i.test(params.name)) {
        return {
          error:
            `'${params.name}' looks like a template package. install_package can't install templates — use install_template({slug}) instead. The slug is in state.providedContext._templateSlug. install_template handles the platform-api lookup, GitHub install, and canonical-name resolution in one call.`,
        };
      }

      const githubShorthand = isGithubShorthand(params.name);
      const installSpec = githubShorthand
        ? params.name
        : params.version && params.version !== ''
          ? `${params.name}@${params.version}`
          : `${params.name}@latest`;
      logger.debug('admin_tool_install_package', {
        name: params.name,
        version: params.version,
        github: githubShorthand,
      });

      try {
        await execFileAsync('npm', ['install', installSpec], {
          cwd: repoRoot,
          timeout: NPM_INSTALL_TIMEOUT_MS,
        });
        // After install, look up the canonical package name. For npm
        // names this is the same as `params.name`; for GitHub shorthand
        // we need to read the freshly-installed package.json#name.
        const resolvedName = githubShorthand
          ? await resolveGithubInstalledName(repoRoot, params.name) ?? params.name
          : params.name;
        await addToAmodalPackages(repoRoot, resolvedName);
        const friendly = await readPackageDisplayName(repoRoot, resolvedName);
        ctx.setLabel?.({completed: friendly ? `Added ${friendly}` : 'Added the package'});
        ctx.log(`Installed ${installSpec}${resolvedName !== params.name ? ` → ${resolvedName}` : ''}`);
        return {ok: true, package: resolvedName};
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        logger.warn('admin_tool_install_package_failed', {name: params.name, error: message});
        return {error: `Failed to install ${params.name}: ${message}`};
      }
    },
  });

  // -------------------------------------------------------------------------
  // install_template — clone template + install connection deps + compose Plan
  // -------------------------------------------------------------------------
  //
  // Templates are starting points, not runtime dependencies — so we
  // CLONE the GitHub repo into a temp dir, copy the template's
  // skills/knowledge/automations/etc. into the user's repo (vendored),
  // install the connection packages the template references (those ARE
  // real npm deps), compose the SetupPlan from the vendored template.json,
  // and emit a `plan_summary` SSE event. One tool call, one full Path A
  // installation step. The user's repo ends up with template files at
  // root + connection packages in node_modules — same shape as a hand-
  // crafted agent repo.
  registry.register('install_template', {
    description:
      '**THE ONLY TOOL FOR TEMPLATE INSTALL.** Clones the template repo into the user\'s working directory (vendored — not buried in node_modules), installs the connection packages the template references via npm, composes the SetupPlan from the template.json, and emits a plan_summary card. Pass the platform-api slug from `state.providedContext._templateSlug`. Returns `{ok: true, plan, displayName, slug}` on success. **You don\'t need to call `load_template_plan` after this** — the Plan is already in the result and the summary card is already emitted. Just `update_setup_state({phase: \'connecting_required\', plan})` with the returned plan and walk the slots.',
    parameters: z.object({
      slug: z.string().describe('Platform-api slug from state.providedContext._templateSlug'),
    }),
    readOnly: false,
    metadata: {category: 'admin'},
    runningLabel: "Installing template '{{slug}}'",
    completedLabel: "Installed template '{{slug}}'",

    async execute(params: {slug: string}, ctx: ToolContext) {
      logger.debug('admin_tool_install_template', {slug: params.slug});

      ctx.setLabel?.({running: `Looking up template '${params.slug}'`});

      // 1. Resolve slug → metadata via Studio
      const metadata = await fetchTemplateMetadata(params.slug);
      if ('error' in metadata) return {error: metadata.error};
      const {githubRepo, defaultBranch, displayName, slug} = metadata;

      ctx.setLabel?.({running: `Cloning ${displayName}`});

      // 2. Clone the template into a temp dir
      const tempDir = await mkdtemp(path.join(os.tmpdir(), 'amodal-template-'));
      try {
        const cloneUrl = `https://github.com/${githubRepo}.git`;
        try {
          await execFileAsync(
            'git',
            ['clone', '--depth', '1', '--branch', defaultBranch, cloneUrl, tempDir],
            {timeout: NPM_INSTALL_TIMEOUT_MS},
          );
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : String(err);
          logger.warn('admin_tool_install_template_clone_failed', {githubRepo, error: message});
          return {error: `Failed to clone ${githubRepo}: ${message}`};
        }

        // 3. Copy template directories into user's repo (vendored).
        //    `force: false` means we don't overwrite anything the user
        //    has there already.
        const VENDORED_DIRS = [
          'skills', 'knowledge', 'automations', 'connections',
          'agents', 'tools', 'pages', 'evals', 'stores',
        ];
        for (const dir of VENDORED_DIRS) {
          const src = path.join(tempDir, dir);
          if (existsSync(src)) {
            await cp(src, path.join(repoRoot, dir), {recursive: true, force: false});
          }
        }
        // template.json itself goes to repoRoot too — composePlan reads it from there.
        const tplJsonSrc = path.join(tempDir, 'template.json');
        if (!existsSync(tplJsonSrc)) {
          return {error: `Template ${githubRepo} has no template.json at the repo root`};
        }
        await cp(tplJsonSrc, path.join(repoRoot, 'template.json'), {force: false});

        // Also copy the template's package.json — it lists the
        // connection packages as real npm dependencies, which is what
        // we want as the user's repo root. Without this, `npm install`
        // walks up the directory tree looking for the nearest
        // package.json (potentially landing on the user's home dir
        // package.json) and "satisfies" the deps from there, leaving
        // the local node_modules empty.
        const tplPkgJsonSrc = path.join(tempDir, 'package.json');
        const localPkgJson = path.join(repoRoot, 'package.json');
        if (existsSync(tplPkgJsonSrc)) {
          await cp(tplPkgJsonSrc, localPkgJson, {force: false});
        } else if (!existsSync(localPkgJson)) {
          // Defensive fallback: template didn't ship one. Seed a
          // minimal package.json so `npm install` operates locally.
          const seedName = path.basename(repoRoot).replace(/[^a-z0-9-]/gi, '-').toLowerCase() || 'agent';
          await writeFile(
            localPkgJson,
            `${JSON.stringify({name: seedName, version: '1.0.0', private: true}, null, 2)}\n`,
            'utf-8',
          );
        }

        // 4. Read template.json from the clone and identify connection packages
        const templateJsonRaw: unknown = JSON.parse(await readFile(tplJsonSrc, 'utf-8'));
        const connectionPackages = collectConnectionPackages(templateJsonRaw);

        ctx.setLabel?.({
          running:
            connectionPackages.length === 1
              ? `Installing 1 connection package`
              : `Installing ${String(connectionPackages.length)} connection packages`,
        });

        // 5. Install dependencies declared in the template's
        //    package.json. The template author lists connection
        //    packages there with version constraints; `npm install`
        //    (no args) honors those exactly. We also pass the
        //    connection packages from `template.json#connections` as
        //    a defensive fallback so that even if the template's
        //    package.json is missing one (authoring bug), it still
        //    gets installed. Capture stdout/stderr so we can surface
        //    npm's output if anything goes sideways.
        let npmStdout = '';
        let npmStderr = '';
        const installArgs = connectionPackages.length > 0
          ? ['install', ...connectionPackages]
          : ['install'];
        try {
          const result = await execFileAsync('npm', installArgs, {
            cwd: repoRoot,
            timeout: NPM_INSTALL_TIMEOUT_MS,
          });
          npmStdout = result.stdout;
          npmStderr = result.stderr;
          logger.info('admin_tool_install_template_deps_done', {
            args: installArgs,
            stdoutPreview: npmStdout.slice(-500),
            stderrPreview: npmStderr.slice(-500),
          });
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : String(err);
          const stdout = isObject(err) && typeof err['stdout'] === 'string' ? err['stdout'] : '';
          const stderr = isObject(err) && typeof err['stderr'] === 'string' ? err['stderr'] : '';
          logger.warn('admin_tool_install_template_deps_failed', {
            args: installArgs,
            error: message,
            stdout,
            stderr,
          });
          return {
            error: `Cloned ${githubRepo} but couldn't install connection packages: ${message}\n\nnpm stderr:\n${stderr || '(empty)'}`,
          };
        }

        // 6. Verify every option package is actually on disk. npm
        //    install can succeed for some packages and silently leave
        //    others uninstalled (e.g. peer-dep skips, scope auth
        //    misses, a single name being unpublished). If we let this
        //    slip, composePlan fills in `displayName='unknown'`
        //    placeholders and the agent emits Configure panels for
        //    packages that aren't there → 404 on click. Fail loudly.
        const missing: string[] = [];
        for (const pkg of connectionPackages) {
          const pkgDir = path.join(repoRoot, 'node_modules', ...pkg.split('/'));
          if (!existsSync(path.join(pkgDir, 'package.json'))) {
            missing.push(pkg);
          }
        }
        if (missing.length > 0) {
          // Pull the last few lines of npm's debug log so we get a
          // hint at WHY the packages didn't install — silent skips
          // (auth, registry mismatch) are otherwise invisible.
          let npmHint = '';
          try {
            const {readdir: rd, readFile: rf, stat} = await import('node:fs/promises');
            const logsDir = path.join(os.homedir(), '.npm', '_logs');
            if (existsSync(logsDir)) {
              const logs = await rd(logsDir);
              if (logs.length > 0) {
                const stats = await Promise.all(
                  logs.map(async (n) => ({n, s: await stat(path.join(logsDir, n))})),
                );
                stats.sort((a, b) => b.s.mtimeMs - a.s.mtimeMs);
                if (stats[0]) {
                  const recent = await rf(path.join(logsDir, stats[0].n), 'utf-8');
                  npmHint = recent.split('\n').slice(-30).join('\n');
                }
              }
            }
          } catch {
            // best-effort; missing log shouldn't block the error
          }
          logger.warn('admin_tool_install_template_packages_missing', {missing, npmHintPreview: npmHint.slice(-400)});
          return {
            error:
              `Template ${githubRepo} cloned and npm install ran (exit 0), but ${missing.length} ` +
              `connection package(s) didn't land on disk: ${missing.join(', ')}.\n\n` +
              `Common causes: scope auth misconfigured (check ~/.npmrc for ${missing[0]?.split('/')[0]} ` +
              `registry/_authToken), package not published under that name, or registry URL mismatch.\n\n` +
              (npmHint
                ? `Recent npm log tail:\n${npmHint}`
                : `(no npm logs found at ~/.npm/_logs)`),
          };
        }

        ctx.setLabel?.({running: `Composing plan from ${displayName}`});

        // 7. Compose the Plan. composePlan reads the now-vendored
        //    template.json from repoRoot and walks each connection
        //    option's package.json#amodal in node_modules. With the
        //    verification above, every option's package.json is on
        //    disk, so composePlan can't fall back to placeholders.
        let plan;
        try {
          plan = await composePlan({repoPath: repoRoot, templatePackage: slug});
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : String(err);
          logger.warn('admin_tool_install_template_compose_failed', {slug, error: message});
          return {error: `Cloned ${githubRepo} but couldn't compose the Plan: ${message}`};
        }

        // 7. Emit plan_summary SSE event so the user sees the loaded
        //    plan rendered as a card inline.
        ctx.emit?.(buildPlanSummaryEvent(plan));

        ctx.setLabel?.({completed: `Set up ${displayName}`});
        ctx.log(`Cloned ${githubRepo} into agent repo (${connectionPackages.length} connection packages installed)`);
        return {ok: true, slug, displayName, plan};
      } finally {
        // Always clean up the temp clone — we vendored what we needed.
        await rm(tempDir, {recursive: true, force: true}).catch(() => undefined);
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
    runningLabel: 'Writing skill {{name}}',
    completedLabel: 'Wrote skill {{name}}',

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
 * Fetch template metadata from Studio's resolver. Returns a normalized
 * shape or `{error}` for soft-fail.
 */
interface TemplateMetadata {
  slug: string;
  displayName: string;
  githubRepo: string;
  defaultBranch: string;
}

async function fetchTemplateMetadata(slug: string): Promise<TemplateMetadata | {error: string}> {
  const studioUrl = process.env['STUDIO_URL'];
  if (!studioUrl) {
    return {error: 'STUDIO_URL is not set — admin agent cannot reach the template resolver'};
  }
  const resolverUrl = `${studioUrl.replace(/\/$/, '')}/api/studio/template/${encodeURIComponent(slug)}`;
  let res: Response;
  try {
    res = await fetch(resolverUrl, {signal: AbortSignal.timeout(8_000)});
  } catch (err: unknown) {
    return {error: `Template resolver unreachable: ${err instanceof Error ? err.message : String(err)}`};
  }
  if (res.status === 404) return {error: `No template registered for slug "${slug}"`};
  if (!res.ok) return {error: `Template resolver returned ${String(res.status)}`};
  let body: unknown;
  try {
    body = await res.json();
  } catch (err: unknown) {
    return {error: `Resolver returned invalid JSON: ${err instanceof Error ? err.message : String(err)}`};
  }
  if (typeof body !== 'object' || body === null) {
    return {error: 'Resolver returned a non-object response'};
  }
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- system boundary: parsing JSON
  const meta = body as Record<string, unknown>;
  const githubRepo = meta['githubRepo'];
  if (typeof githubRepo !== 'string' || githubRepo.length === 0) {
    return {error: `Resolver response missing githubRepo for slug "${slug}"`};
  }
  return {
    slug: typeof meta['slug'] === 'string' ? meta['slug'] : slug,
    displayName: typeof meta['displayName'] === 'string' ? meta['displayName'] : slug,
    githubRepo,
    defaultBranch: typeof meta['defaultBranch'] === 'string' ? meta['defaultBranch'] : 'main',
  };
}

/**
 * Walk template.json#connections[] and collect every option's package
 * name. Options can be either bare strings ("@amodalai/connection-slack")
 * or `{packageName: "...", ...}` objects. Returns deduped list.
 */
function collectConnectionPackages(templateJson: unknown): string[] {
  if (typeof templateJson !== 'object' || templateJson === null) return [];
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- system boundary
  const tj = templateJson as Record<string, unknown>;
  const connections = tj['connections'];
  if (!Array.isArray(connections)) return [];
  const pkgs = new Set<string>();
  for (const slot of connections) {
    if (typeof slot !== 'object' || slot === null) continue;
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- system boundary
    const options = (slot as Record<string, unknown>)['options'];
    if (!Array.isArray(options)) continue;
    for (const opt of options) {
      if (typeof opt === 'string' && opt.length > 0) {
        pkgs.add(opt);
      } else if (typeof opt === 'object' && opt !== null) {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- system boundary
        const pkgName = (opt as Record<string, unknown>)['packageName'];
        if (typeof pkgName === 'string' && pkgName.length > 0) pkgs.add(pkgName);
      }
    }
  }
  return [...pkgs];
}

/**
 * Build a `plan_summary` SSE event from a composed `SetupPlan`.
 * Shape mirrors `SSEPlanSummaryEvent` in `@amodalai/types`.
 */
function buildPlanSummaryEvent(plan: {
  templatePackage: string;
  slots: Array<{
    label: string;
    description: string;
    required: boolean;
    options: Array<{packageName: string; displayName: string}>;
  }>;
  config: Array<{key: string; question: string}>;
  completion: {title: string; suggestions: string[]};
}): SSEPlanSummaryEvent {
  const slotPayload = (s: typeof plan.slots[number]): {
    label: string;
    description: string;
    options: Array<{display_name: string; package_name: string}>;
  } => ({
    label: s.label,
    description: s.description,
    options: s.options.map((o) => ({display_name: o.displayName, package_name: o.packageName})),
  });
  return {
    type: SSEEventType.PlanSummary,
    template_title: plan.completion.title || plan.templatePackage,
    required_slots: plan.slots.filter((s) => s.required).map(slotPayload),
    optional_slots: plan.slots.filter((s) => !s.required).map(slotPayload),
    config_questions: plan.config.map((q) => ({key: q.key, question: q.question})),
    completion_suggestions: plan.completion.suggestions,
    timestamp: new Date().toISOString(),
  };
}

/**
 * Detect npm GitHub shorthand: `<owner>/<repo>`. npm accepts these as
 * package specs to clone the repo and install it. Distinguishes from
 * scoped npm packages (start with `@`) and unscoped names (no `/`).
 */
function isGithubShorthand(name: string): boolean {
  if (name.startsWith('@')) return false;
  return name.includes('/');
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/**
 * Best-effort read of an installed package's friendly display name.
 * Looks at `amodal.displayName` then top-level `displayName` in the
 * package's package.json. Returns null when neither is set or the
 * package isn't on disk yet.
 */
async function readPackageDisplayName(repoPath: string, packageName: string): Promise<string | null> {
  const pkgJsonPath = path.join(repoPath, 'node_modules', ...packageName.split('/'), 'package.json');
  if (!existsSync(pkgJsonPath)) return null;
  try {
    const raw: unknown = JSON.parse(await readFile(pkgJsonPath, 'utf-8'));
    if (!isObject(raw)) return null;
    const amodal = raw['amodal'];
    if (isObject(amodal) && typeof amodal['displayName'] === 'string' && amodal['displayName'].length > 0) {
      return amodal['displayName'];
    }
    const top = raw['displayName'];
    if (typeof top === 'string' && top.length > 0) return top;
    return null;
  } catch {
    return null;
  }
}

/**
 * After `npm install <owner>/<repo>` succeeds, look up the canonical
 * npm name (`package.json#name`) of what landed.
 *
 * Strategy 1 (cheap): read the root `package.json#dependencies`,
 * find the entry whose value contains the GitHub spec.
 *
 * Strategy 2 (fallback): walk top-level `node_modules/<dir>` and
 * `node_modules/@scope/<dir>`, read each `package.json`, return the
 * `name` field of the first one whose `_resolved`, `_from`, or
 * `repository.url` references the GitHub spec. Necessary when npm's
 * dep entry doesn't literally contain the spec (e.g. it rewrote to
 * `github:<owner>/<repo>#<sha>` and our prefix match misses).
 *
 * Returns null when both strategies miss; caller falls back to the
 * literal spec.
 */
async function resolveGithubInstalledName(
  repoRoot: string,
  githubSpec: string,
): Promise<string | null> {
  // Strategy 1 — root package.json#dependencies
  const fromRootDeps = await tryRootPackageJson(repoRoot, githubSpec);
  if (fromRootDeps) return fromRootDeps;

  // Strategy 2 — walk node_modules
  return tryWalkNodeModules(repoRoot, githubSpec);
}

async function tryRootPackageJson(repoRoot: string, githubSpec: string): Promise<string | null> {
  const pkgJsonPath = path.join(repoRoot, 'package.json');
  let raw: string;
  try {
    raw = await readFile(pkgJsonPath, 'utf-8');
  } catch {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) return null;
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- system boundary: parsed root package.json
  const config = parsed as Record<string, unknown>;
  const deps = config['dependencies'];
  if (typeof deps !== 'object' || deps === null) return null;
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- system boundary
  const entries = Object.entries(deps as Record<string, unknown>);
  const match = entries.find(
    ([, value]) => typeof value === 'string' && value.includes(githubSpec),
  );
  return match ? match[0] : null;
}

async function tryWalkNodeModules(repoRoot: string, githubSpec: string): Promise<string | null> {
  const {readdir} = await import('node:fs/promises');
  const nmDir = path.join(repoRoot, 'node_modules');
  let topLevel: string[];
  try {
    topLevel = await readdir(nmDir);
  } catch {
    return null;
  }

  for (const entry of topLevel) {
    if (entry.startsWith('.')) continue;
    if (entry.startsWith('@')) {
      // Scoped package — recurse one level
      const scopeDir = path.join(nmDir, entry);
      let scopedEntries: string[];
      try {
        scopedEntries = await readdir(scopeDir);
      } catch {
        continue;
      }
      for (const sub of scopedEntries) {
        const match = await readPackageNameIfMatching(path.join(scopeDir, sub), githubSpec);
        if (match) return match;
      }
    } else {
      const match = await readPackageNameIfMatching(path.join(nmDir, entry), githubSpec);
      if (match) return match;
    }
  }
  return null;
}

async function readPackageNameIfMatching(
  pkgDir: string,
  githubSpec: string,
): Promise<string | null> {
  const pkgJsonPath = path.join(pkgDir, 'package.json');
  let raw: string;
  try {
    raw = await readFile(pkgJsonPath, 'utf-8');
  } catch {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) return null;
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- system boundary
  const pkg = parsed as Record<string, unknown>;
  const name = pkg['name'];
  if (typeof name !== 'string' || name.length === 0) return null;

  // Check the install metadata fields npm writes for git/github installs.
  const candidates = [
    pkg['_resolved'],
    pkg['_from'],
    typeof pkg['repository'] === 'object' && pkg['repository'] !== null
      ? // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- system boundary
        (pkg['repository'] as Record<string, unknown>)['url']
      : undefined,
  ];
  for (const c of candidates) {
    if (typeof c === 'string' && c.includes(githubSpec)) return name;
  }
  return null;
}

/**
 * Add `name` to `amodal.json#packages` if absent. Idempotent.
 *
 * No-ops silently when `amodal.json` is missing — that's the expected
 * setup-mode state (empty repo, admin agent running its first
 * install). `commit_setup` composes the final `amodal.json` from
 * `state.plan.templatePackage` + `state.completed[]` at the end of
 * setup, and Studio's repo-state polling watches for `amodal.json`
 * as the "setup complete, switch to admin view" signal — eagerly
 * scaffolding it here would flip the page mid-flow. The package is
 * still installed by npm and visible in `node_modules/`; we just
 * don't update the agent config until commit time.
 */
async function addToAmodalPackages(repoRoot: string, name: string): Promise<void> {
  const configPath = path.join(repoRoot, 'amodal.json');
  let raw: string;
  try {
    raw = await readFile(configPath, 'utf-8');
  } catch (err: unknown) {
    if (isNotFoundError(err)) return;
    throw err;
  }
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

function isNotFoundError(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as {code?: unknown}).code === 'ENOENT'
  );
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
