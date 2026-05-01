/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

/**
 * `composePlan` — derive a `SetupPlan` from an installed template
 * package's existing files. Phase C of the admin-setup build plan.
 *
 * Input: the agent's `repoPath` (so `node_modules/<pkg>/` resolves)
 * and the template package's npm name. Output: a typed `SetupPlan`
 * the admin agent walks through during onboarding.
 *
 * Three sources, all already authored by template authors for other
 * reasons — `composePlan` writes nothing new:
 *
 *   1. `node_modules/<pkg>/template.json` — slot label / description /
 *      options[] / required / multi.
 *   2. Each option's `node_modules/<option>/package.json#amodal` —
 *      displayName, auth.type, oauth.scopes, icon, category.
 *   3. `node_modules/<pkg>/automations/*` — schedule + title for
 *      the configuring-phase question and the completion preview.
 *
 * Optional `template.json#setup` polish (`scheduleReasoning`,
 * `completionSuggestions`, `dataPointTemplates`) shallow-merges over
 * the deterministic skeleton.
 *
 * Missing-option handling: a slot's option whose package isn't yet
 * installed gets a placeholder (displayName = bare package name,
 * authType = 'unknown'). Required slots typically install all
 * options up-front; optional slots can defer-install via lazy npm
 * metadata fetches in a future iteration.
 */

import {existsSync} from 'node:fs';
import {readFile} from 'node:fs/promises';
import * as path from 'node:path';

import type {
  SetupPlan,
  SetupPlanSlot,
  SetupPlanSlotOption,
  SetupPlanConfigQuestion,
  SetupPlanCompletion,
  SetupPolish,
} from '@amodalai/types';

import {RepoError} from '../repo/repo-types.js';

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface ComposePlanOptions {
  /** Absolute path to the agent repo root (where `node_modules/` lives). */
  repoPath: string;
  /** npm package name of the template (e.g. "@amodalai/marketing-ops"). */
  templatePackage: string;
}

export async function composePlan(opts: ComposePlanOptions): Promise<SetupPlan> {
  // Templates are now vendored into the user's repo by `install_template`
  // (clone-and-copy), so `template.json` lives at `<repoPath>/template.json`
  // rather than buried under `node_modules/<pkg>/`. Try the vendored path
  // first; fall back to the legacy `node_modules/<pkg>/` lookup so old
  // tests / callers that still pass a real npm package name keep working.
  const vendoredJsonPath = path.join(opts.repoPath, 'template.json');
  let templateDir: string;
  let templateJson: Record<string, unknown>;
  let resolvedName: string;
  if (existsSync(vendoredJsonPath)) {
    templateDir = opts.repoPath;
    templateJson = await readTemplateJson(templateDir, opts.templatePackage || 'vendored');
    resolvedName = opts.templatePackage || 'vendored-template';
  } else {
    resolvedName = await resolveInstalledName(opts.repoPath, opts.templatePackage);
    templateDir = resolvePackageDir(opts.repoPath, resolvedName);
    templateJson = await readTemplateJson(templateDir, resolvedName);
  }
  const polish = isObject(templateJson['setup']) ? (templateJson['setup'] as SetupPolish) : {};

  const rawSlots = isArray(templateJson['connections']) ? templateJson['connections'] : [];
  const slots = await Promise.all(
    rawSlots.map((raw) => composeSlot(opts.repoPath, raw, resolvedName)),
  );

  const automations = await readAutomations(templateDir, resolvedName);
  const config = composeConfigQuestions(automations, polish);
  const completion = composeCompletion(resolvedName, automations, polish);

  const result: SetupPlan = {
    templatePackage: resolvedName,
    slots,
    config,
    completion,
  };
  if (polish.dataPointTemplates && Object.keys(polish.dataPointTemplates).length > 0) {
    result.dataPointTemplates = sanitizeDataPointTemplates(polish.dataPointTemplates);
  }
  return result;
}

/**
 * Strip any non-string values from `dataPointTemplates` and clamp
 * each template to a defensive max length. Templates flow through
 * to the LLM as raw strings; an oversized or non-string value would
 * either blow up tool args or get rendered as `[object Object]`.
 */
function sanitizeDataPointTemplates(raw: Record<string, string>): Record<string, string> {
  const TEMPLATE_MAX_LEN = 240;
  const sanitized: Record<string, string> = {};
  for (const [slot, template] of Object.entries(raw)) {
    if (typeof template !== 'string') continue;
    sanitized[slot] = template.length > TEMPLATE_MAX_LEN
      ? template.slice(0, TEMPLATE_MAX_LEN)
      : template;
  }
  return sanitized;
}

// ---------------------------------------------------------------------------
// Slot composition
// ---------------------------------------------------------------------------

async function composeSlot(
  repoPath: string,
  raw: unknown,
  templatePackage: string,
): Promise<SetupPlanSlot> {
  if (!isObject(raw)) {
    throw new RepoError(
      'CONFIG_VALIDATION_FAILED',
      `Template "${templatePackage}" has a connections[] entry that is not an object.`,
    );
  }
  const label = pickString(raw['label']);
  const description = pickString(raw['description']);
  if (!label) {
    throw new RepoError(
      'CONFIG_VALIDATION_FAILED',
      `Template "${templatePackage}" has a connection slot with no label.`,
    );
  }
  const required = raw['required'] !== false; // default true (matches spec wording)
  const multi = raw['multi'] === true;

  const rawOptions = isArray(raw['options']) ? raw['options'] : [];
  const options = await Promise.all(
    rawOptions
      .filter((o): o is string => typeof o === 'string' && o.length > 0)
      .map((pkgName) => composeOption(repoPath, pkgName)),
  );

  return {
    label,
    description: description ?? '',
    required,
    multi,
    options,
  };
}

async function composeOption(
  repoPath: string,
  packageName: string,
): Promise<SetupPlanSlotOption> {
  const pkgDir = resolvePackageDir(repoPath, packageName);
  const pkgJson = await readPackageJsonOrNull(pkgDir);

  // Package not installed — return a placeholder so the agent can
  // still surface the option name. Required slots typically install
  // up front; optional alternatives may not be present locally.
  if (!pkgJson) {
    return {
      packageName,
      displayName: humanizePackageName(packageName),
      authType: 'unknown',
      oauthScopes: [],
    };
  }

  const amodal = isObject(pkgJson['amodal']) ? pkgJson['amodal'] : {};
  const displayName = pickString(amodal['displayName']) ?? humanizePackageName(packageName);
  const auth = isObject(amodal['auth']) ? amodal['auth'] : {};
  const authTypeRaw = pickString(auth['type']);
  const authType = isAuthType(authTypeRaw) ? authTypeRaw : 'unknown';
  const oauth = isObject(amodal['oauth']) ? amodal['oauth'] : {};
  const oauthScopes = isArray(oauth['scopes'])
    ? oauth['scopes'].filter((s): s is string => typeof s === 'string')
    : [];

  const option: SetupPlanSlotOption = {
    packageName,
    displayName,
    authType,
    oauthScopes,
  };
  const icon = pickString(amodal['icon']);
  if (icon) option.icon = icon;
  const category = pickString(amodal['category']);
  if (category) option.category = category;
  return option;
}

// ---------------------------------------------------------------------------
// Config questions (driven by automations)
// ---------------------------------------------------------------------------

interface AutomationMeta {
  name: string;
  title: string | null;
  schedule: string | null;
}

function composeConfigQuestions(
  automations: AutomationMeta[],
  polish: SetupPolish,
): SetupPlanConfigQuestion[] {
  // For Phase C we only emit a `schedule` question when the template
  // ships at least one automation with a schedule. Future templates
  // can extend with their own config questions; the Plan format is
  // additive.
  const first = automations.find((a) => a.schedule !== null);
  if (!first) return [];

  const defaultSchedule = first.schedule ?? '0 8 * * 1';
  const options = scheduleOptions(defaultSchedule);

  const question: SetupPlanConfigQuestion = {
    key: 'schedule',
    question: 'When should the agent run?',
    options,
    required: true,
  };
  if (polish.scheduleReasoning) question.reasoning = polish.scheduleReasoning;
  return [question];
}

function scheduleOptions(defaultSchedule: string): SetupPlanConfigQuestion['options'] {
  // Always offer the template's own default first (highlighted as
  // the recommendation), then a couple of generic alternatives, then
  // a Custom escape hatch the agent can prompt for via ask_choice.
  return [
    {label: humanizeCron(defaultSchedule), value: defaultSchedule},
    {label: 'Monday 8 AM', value: '0 8 * * 1'},
    {label: 'Friday 4 PM', value: '0 16 * * 5'},
    {label: 'Custom', value: 'custom'},
  ];
}

function humanizeCron(expr: string): string {
  // Lightweight humanizer for the common patterns the spec uses.
  // Falls through to the raw cron string when the pattern doesn't match
  // — the agent surfaces the value verbatim and explains in prose.
  const map: Record<string, string> = {
    '0 8 * * 1': 'Monday 8 AM',
    '0 9 * * 1': 'Monday 9 AM',
    '0 16 * * 5': 'Friday 4 PM',
    '0 9 * * *': 'Daily 9 AM',
  };
  return map[expr] ?? expr;
}

// ---------------------------------------------------------------------------
// Completion preview
// ---------------------------------------------------------------------------

function composeCompletion(
  templatePackage: string,
  automations: AutomationMeta[],
  polish: SetupPolish,
): SetupPlanCompletion {
  const automation = automations[0];
  return {
    title: humanizePackageName(templatePackage),
    suggestions: polish.completionSuggestions ?? [],
    automationTitle: automation?.title ?? null,
  };
}

// ---------------------------------------------------------------------------
// File reading helpers
// ---------------------------------------------------------------------------

async function readTemplateJson(
  templateDir: string,
  templatePackage: string,
): Promise<Record<string, unknown>> {
  const filePath = path.join(templateDir, 'template.json');
  let content: string;
  try {
    content = await readFile(filePath, 'utf-8');
  } catch {
    throw new RepoError(
      'CONFIG_NOT_FOUND',
      `Template "${templatePackage}" has no template.json at ${filePath}. ` +
        'Templates must ship a template.json with a connections[] block.',
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch (err) {
    throw new RepoError(
      'CONFIG_PARSE_FAILED',
      `Invalid JSON in template.json for "${templatePackage}".`,
      err,
    );
  }
  if (!isObject(parsed)) {
    throw new RepoError(
      'CONFIG_VALIDATION_FAILED',
      `template.json for "${templatePackage}" is not a JSON object.`,
    );
  }
  return parsed;
}

async function readPackageJsonOrNull(pkgDir: string): Promise<Record<string, unknown> | null> {
  try {
    const content = await readFile(path.join(pkgDir, 'package.json'), 'utf-8');
    const parsed: unknown = JSON.parse(content);
    return isObject(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

async function readAutomations(
  templateDir: string,
  templatePackage: string,
): Promise<AutomationMeta[]> {
  const automationsDir = path.join(templateDir, 'automations');
  let entries: string[];
  try {
    const {readdir} = await import('node:fs/promises');
    entries = await readdir(automationsDir);
  } catch {
    return [];
  }

  const results: AutomationMeta[] = [];
  for (const entry of entries) {
    const full = path.join(automationsDir, entry);
    const ext = path.extname(entry);
    const base = entry.slice(0, entry.length - ext.length);
    if (ext === '.json') {
      const meta = await readAutomationJson(full, base, templatePackage);
      if (meta) results.push(meta);
    } else if (ext === '.md') {
      const meta = await readAutomationMarkdown(full, base);
      if (meta) results.push(meta);
    }
  }
  return results;
}

async function readAutomationJson(
  filePath: string,
  name: string,
  templatePackage: string,
): Promise<AutomationMeta | null> {
  let content: string;
  try {
    content = await readFile(filePath, 'utf-8');
  } catch {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch (err) {
    throw new RepoError(
      'CONFIG_PARSE_FAILED',
      `Invalid JSON in automations/${name}.json for "${templatePackage}".`,
      err,
    );
  }
  if (!isObject(parsed)) return null;
  return {
    name,
    title: pickString(parsed['title']) ?? null,
    schedule: pickString(parsed['schedule']) ?? null,
  };
}

async function readAutomationMarkdown(
  filePath: string,
  name: string,
): Promise<AutomationMeta | null> {
  let content: string;
  try {
    content = await readFile(filePath, 'utf-8');
  } catch {
    return null;
  }
  // Title from first `# ` heading. "Automation: " prefix is stripped to
  // match the parsers.ts convention.
  const titleMatch = /^#\s+(?:Automation:\s+)?(.+)$/m.exec(content);
  const title = titleMatch ? titleMatch[1].trim() : null;
  // Schedule from `**Schedule**: \`<cron>\``-style line in the Trigger
  // section, mirroring how marketing-ops/automations/*.md are authored.
  const scheduleMatch = /\*\*Schedule\*\*\s*:\s*`([^`]+)`/i.exec(content);
  const schedule = scheduleMatch ? scheduleMatch[1].trim() : null;
  return {name, title, schedule};
}

// ---------------------------------------------------------------------------
// Path + value helpers
// ---------------------------------------------------------------------------

function resolvePackageDir(repoPath: string, packageName: string): string {
  // Mirrors @amodalai/core/packages/resolver.ts conventions: scoped
  // packages live at `node_modules/@scope/name/`, unscoped at
  // `node_modules/name/`.
  return path.join(repoPath, 'node_modules', ...packageName.split('/'));
}

/**
 * Resolve the literal name we got handed (which may be either the
 * canonical npm name OR an `<owner>/<repo>` GitHub spec the agent
 * grabbed off `install_template`'s output) to whatever's actually
 * installed in `node_modules/`.
 *
 * Strategy: try the literal path first. If absent AND the name
 * looks like a GitHub spec (contains `/`, doesn't start with `@`),
 * consult the root `package.json#dependencies` — npm rewrites the
 * dep value to `github:<owner>/<repo>` (or similar) on install, so
 * the entry whose value contains the spec gives us the canonical
 * name. If we can't disambiguate, fall back to the literal name —
 * the downstream readTemplateJson will surface a clean
 * "not_installed" error.
 */
async function resolveInstalledName(repoPath: string, name: string): Promise<string> {
  if (existsSync(resolvePackageDir(repoPath, name))) return name;

  if (!isGithubSpec(name)) return name;

  // Strategy 1 — root package.json#dependencies, find dep value
  // referencing the GitHub spec.
  const fromRootDeps = await tryRootDeps(repoPath, name);
  if (fromRootDeps) return fromRootDeps;

  // Strategy 2 — walk node_modules/, read each package.json, return
  // the first whose `_resolved` / `_from` / `repository.url` mentions
  // the GitHub spec. Catches the case where npm rewrote the dep
  // entry to a form that doesn't contain the literal spec.
  const fromWalk = await tryWalkNodeModules(repoPath, name);
  if (fromWalk) return fromWalk;

  return name;
}

async function tryRootDeps(repoPath: string, githubSpec: string): Promise<string | null> {
  const pkgJsonPath = path.join(repoPath, 'package.json');
  if (!existsSync(pkgJsonPath)) return null;
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
  if (!isObject(parsed)) return null;
  const deps = parsed['dependencies'];
  if (!isObject(deps)) return null;
  for (const [depName, depValue] of Object.entries(deps)) {
    if (typeof depValue !== 'string') continue;
    if (depValue.includes(githubSpec) && existsSync(resolvePackageDir(repoPath, depName))) {
      return depName;
    }
  }
  return null;
}

async function tryWalkNodeModules(repoPath: string, githubSpec: string): Promise<string | null> {
  const {readdir} = await import('node:fs/promises');
  const nmDir = path.join(repoPath, 'node_modules');
  if (!existsSync(nmDir)) return null;
  let topLevel: string[];
  try {
    topLevel = await readdir(nmDir);
  } catch {
    return null;
  }
  for (const entry of topLevel) {
    if (entry.startsWith('.')) continue;
    if (entry.startsWith('@')) {
      const scopeDir = path.join(nmDir, entry);
      let scopedEntries: string[];
      try {
        scopedEntries = await readdir(scopeDir);
      } catch {
        continue;
      }
      for (const sub of scopedEntries) {
        const match = await matchPackageDir(path.join(scopeDir, sub), githubSpec);
        if (match) return match;
      }
    } else {
      const match = await matchPackageDir(path.join(nmDir, entry), githubSpec);
      if (match) return match;
    }
  }
  return null;
}

async function matchPackageDir(pkgDir: string, githubSpec: string): Promise<string | null> {
  const pkgJsonPath = path.join(pkgDir, 'package.json');
  if (!existsSync(pkgJsonPath)) return null;
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
  if (!isObject(parsed)) return null;
  const pkg = parsed;
  const name = pkg['name'];
  if (typeof name !== 'string' || name.length === 0) return null;

  const candidates = [
    pkg['_resolved'],
    pkg['_from'],
    isObject(pkg['repository']) ? pkg['repository']['url'] : undefined,
    pkg['homepage'],
  ];
  for (const c of candidates) {
    if (typeof c === 'string' && c.includes(githubSpec)) return name;
  }
  // Last-resort heuristic: directory basename matches the GitHub repo
  // basename (e.g. node_modules/template-marketing-operations-hub for
  // GitHub repo whodatdev/template-marketing-operations-hub).
  const repoBasename = githubSpec.split('/').pop() ?? '';
  if (repoBasename.length > 0 && path.basename(pkgDir) === repoBasename) {
    return name;
  }
  return null;
}

function isGithubSpec(name: string): boolean {
  if (name.startsWith('@')) return false;
  return name.includes('/');
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isArray(value: unknown): value is unknown[] {
  return Array.isArray(value);
}

function pickString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

const AUTH_TYPES = ['oauth2', 'bearer', 'api-key', 'basic', 'none'] as const;
type AuthType = (typeof AUTH_TYPES)[number];

function isAuthType(value: string | null): value is AuthType {
  return value !== null && (AUTH_TYPES as readonly string[]).includes(value);
}

function humanizePackageName(packageName: string): string {
  // "@amodalai/connection-slack" -> "Slack"; "@amodalai/marketing-ops" -> "Marketing Ops".
  const tail = packageName.includes('/') ? packageName.slice(packageName.lastIndexOf('/') + 1) : packageName;
  const stripped = tail.replace(/^connection-|^template-|^skill-/, '');
  return stripped
    .split('-')
    .map((word) => (word.length > 0 ? word[0].toUpperCase() + word.slice(1) : word))
    .join(' ');
}
