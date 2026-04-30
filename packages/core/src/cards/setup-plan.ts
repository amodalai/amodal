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
  const templateDir = resolvePackageDir(opts.repoPath, opts.templatePackage);
  const templateJson = await readTemplateJson(templateDir, opts.templatePackage);
  const polish = isObject(templateJson['setup']) ? (templateJson['setup'] as SetupPolish) : {};

  const rawSlots = isArray(templateJson['connections']) ? templateJson['connections'] : [];
  const slots = await Promise.all(
    rawSlots.map((raw) => composeSlot(opts.repoPath, raw, opts.templatePackage)),
  );

  const automations = await readAutomations(templateDir, opts.templatePackage);
  const config = composeConfigQuestions(automations, polish);
  const completion = composeCompletion(opts.templatePackage, automations, polish);

  return {
    templatePackage: opts.templatePackage,
    slots,
    config,
    completion,
  };
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
