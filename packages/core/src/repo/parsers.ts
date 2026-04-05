/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import {ZodError} from 'zod';
import yaml from 'js-yaml';

import {parseConfigJson} from './config-schema.js';
import {AccessConfigSchema, ConnectionSpecSchema} from './connection-schemas.js';
import type {AccessConfig, ConnectionSpec} from './connection-schemas.js';
import type {LoadedConnection} from './connection-types.js';
import {
  RepoError,
} from './repo-types.js';
import type {
  DeliveryConfig,
  DeliveryTarget,
  FailureAlertConfig,
} from '@amodalai/types';
import type {
  LoadedAgent,
  LoadedAutomation,
  LoadedEval,
  LoadedKnowledge,
  LoadedSkill,
} from './repo-types.js';
import {parseSurface} from './surface-parser.js';

// Re-export parseConfig for convenience
export {parseConfigJson as parseConfig};

/**
 * Parse spec.json content into a validated ConnectionSpec.
 */
export function parseSpecJson(jsonString: string): ConnectionSpec {
  let raw: unknown;
  try {
    raw = JSON.parse(jsonString);
  } catch (err) {
    throw new RepoError('CONFIG_PARSE_FAILED', 'Invalid JSON in spec.json', err);
  }

  try {
    return ConnectionSpecSchema.parse(raw);
  } catch (err) {
    if (err instanceof ZodError) {
      const issues = err.issues
        .map((i) => `${i.path.join('.')}: ${i.message}`)
        .join('; ');
      throw new RepoError(
        'CONFIG_VALIDATION_FAILED',
        `spec.json validation failed: ${issues}`,
        err,
      );
    }
    throw new RepoError('CONFIG_VALIDATION_FAILED', 'spec.json validation failed', err);
  }
}

/**
 * Parse access.json content into a validated AccessConfig.
 */
export function parseAccessJson(jsonString: string): AccessConfig {
  let raw: unknown;
  try {
    raw = JSON.parse(jsonString);
  } catch (err) {
    throw new RepoError('CONFIG_PARSE_FAILED', 'Invalid JSON in access.json', err);
  }

  try {
    return AccessConfigSchema.parse(raw);
  } catch (err) {
    if (err instanceof ZodError) {
      const issues = err.issues
        .map((i) => `${i.path.join('.')}: ${i.message}`)
        .join('; ');
      throw new RepoError(
        'CONFIG_VALIDATION_FAILED',
        `access.json validation failed: ${issues}`,
        err,
      );
    }
    throw new RepoError('CONFIG_VALIDATION_FAILED', 'access.json validation failed', err);
  }
}

/**
 * Parse a full connection from raw file contents.
 */
export function parseConnection(
  name: string,
  files: {
    specJson: string;
    accessJson: string;
    surfaceMd?: string;
    entitiesMd?: string;
    rulesMd?: string;
  },
  location: string,
): LoadedConnection {
  const spec = parseSpecJson(files.specJson);
  const access = parseAccessJson(files.accessJson);
  const surface = files.surfaceMd ? parseSurface(files.surfaceMd) : [];

  return {
    name,
    spec,
    access,
    surface,
    entities: files.entitiesMd,
    rules: files.rulesMd,
    location,
  };
}

// Regex for new-format skill: # Skill: Name
const SKILL_HEADING_RE = /^#\s+Skill:\s+(.+)$/m;
// Regex for Trigger: line
const SKILL_TRIGGER_RE = /^Trigger:\s+(.+)$/m;
// Regex for frontmatter
const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n([\s\S]*))?/;

/**
 * Parse SKILL.md content. Supports both heading-based and frontmatter formats.
 * Returns null if neither format matches.
 */
export function parseSkill(content: string, location: string): LoadedSkill | null {
  // Try new format first: # Skill: Name
  const headingMatch = SKILL_HEADING_RE.exec(content);
  if (headingMatch) {
    const name = headingMatch[1].trim();
    const triggerMatch = SKILL_TRIGGER_RE.exec(content);
    const trigger = triggerMatch ? triggerMatch[1].trim() : undefined;

    // Extract description from text between heading and first ## section
    const afterHeading = content.slice(headingMatch.index + headingMatch[0].length);
    const firstSectionIdx = afterHeading.search(/^##\s+/m);
    let description = '';
    if (firstSectionIdx >= 0) {
      description = afterHeading.slice(0, firstSectionIdx).trim();
      // Remove the trigger line from description
      if (trigger) {
        description = description.replace(SKILL_TRIGGER_RE, '').trim();
      }
    }

    // Body is everything from first ## section onward
    const body = firstSectionIdx >= 0
      ? afterHeading.slice(firstSectionIdx).trim()
      : afterHeading.trim();

    return {name, description, trigger, body, location};
  }

  // Try frontmatter format
  const fmMatch = FRONTMATTER_RE.exec(content);
  if (fmMatch) {
    try {
      const parsed = yaml.load(fmMatch[1]);
      if (parsed && typeof parsed === 'object') {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
        const fm = parsed as Record<string, unknown>;
        const name = typeof fm['name'] === 'string' ? fm['name'] : '';
        const description = typeof fm['description'] === 'string' ? fm['description'] : '';
        const trigger = typeof fm['trigger'] === 'string' ? fm['trigger'] : undefined;
        if (!name) return null;

        const body = (fmMatch[2] ?? '').trim();
        return {name, description, trigger, body, location};
      }
    } catch {
      // YAML parse failed — skip this skill
    }
    return null;
  }

  return null;
}

/**
 * Parse a knowledge markdown file.
 */
export function parseKnowledge(
  content: string,
  name: string,
  location: string,
): LoadedKnowledge {
  // Extract title from first # heading
  const titleMatch = /^#\s+(?:Knowledge:\s+)?(.+)$/m.exec(content);
  const title = titleMatch ? titleMatch[1].trim() : name;

  // Body is everything after the first heading
  let body = content;
  if (titleMatch) {
    body = content.slice(titleMatch.index + titleMatch[0].length).trim();
  }

  return {name, title, body, location};
}

/**
 * Parse an automation JSON file.
 *
 * Expected format:
 * ```json
 * {
 *   "title": "Daily Revenue Digest",
 *   "schedule": "0 9 * * 1-5",
 *   "prompt": "Pull yesterday's revenue data..."
 * }
 * ```
 *
 * - If `schedule` is present, trigger defaults to `"cron"`.
 * - If `trigger` is `"webhook"`, no schedule is needed.
 * - If neither, trigger defaults to `"manual"`.
 */
export function parseAutomation(
  content: string,
  name: string,
  location: string,
): LoadedAutomation {
  let raw: unknown;
  try {
    raw = JSON.parse(content);
  } catch {
    // Fallback: try markdown format for backward compatibility
    return parseAutomationMarkdown(content, name, location);
  }

  if (typeof raw !== 'object' || raw === null) {
    throw new RepoError(
      'CONFIG_PARSE_FAILED',
      `Invalid automation "${name}": expected a JSON object`,
    );
  }

  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- parsed JSON object
  const obj = raw as Record<string, unknown>;

  const title = typeof obj['title'] === 'string' ? obj['title'] : name;
  const prompt = typeof obj['prompt'] === 'string' ? obj['prompt'] : '';
  const schedule = typeof obj['schedule'] === 'string' ? obj['schedule'] : undefined;

  let trigger: 'cron' | 'webhook' | 'manual';
  if (typeof obj['trigger'] === 'string' && ['cron', 'webhook', 'manual'].includes(obj['trigger'])) {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- validated above
    trigger = obj['trigger'] as 'cron' | 'webhook' | 'manual';
  } else if (schedule) {
    trigger = 'cron';
  } else {
    trigger = 'manual';
  }

  const delivery = parseDeliveryConfig(obj['delivery'], name);
  const failureAlert = parseFailureAlertConfig(obj['failureAlert'], name);

  return {name, title, schedule, trigger, prompt, location, delivery, failureAlert};
}

/**
 * Parse and validate a DeliveryTarget from unknown JSON.
 * Returns undefined for invalid entries (caller logs / skips).
 */
function parseDeliveryTarget(raw: unknown, automationName: string): DeliveryTarget | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined;
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- object narrowed above
  const obj = raw as Record<string, unknown>;
  const type = obj['type'];
  if (type === 'webhook') {
    const url = obj['url'];
    if (typeof url !== 'string' || url.length === 0) {
      throw new RepoError(
        'CONFIG_VALIDATION_FAILED',
        `Automation "${automationName}" delivery target: webhook requires a non-empty "url"`,
      );
    }
    return {type: 'webhook', url};
  }
  if (type === 'callback') {
    const name = typeof obj['name'] === 'string' ? obj['name'] : undefined;
    return {type: 'callback', name};
  }
  throw new RepoError(
    'CONFIG_VALIDATION_FAILED',
    `Automation "${automationName}" delivery target: unknown type "${String(type)}". Supported: webhook, callback`,
  );
}

/** Parse delivery config from automation JSON. Returns undefined if absent. */
function parseDeliveryConfig(raw: unknown, automationName: string): DeliveryConfig | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (typeof raw !== 'object') {
    throw new RepoError(
      'CONFIG_VALIDATION_FAILED',
      `Automation "${automationName}" delivery: expected an object`,
    );
  }
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- object narrowed above
  const obj = raw as Record<string, unknown>;
  const targetsRaw = obj['targets'];
  if (!Array.isArray(targetsRaw) || targetsRaw.length === 0) {
    throw new RepoError(
      'CONFIG_VALIDATION_FAILED',
      `Automation "${automationName}" delivery.targets: expected a non-empty array`,
    );
  }
  const targets: DeliveryTarget[] = [];
  for (const t of targetsRaw) {
    const target = parseDeliveryTarget(t, automationName);
    if (target) targets.push(target);
  }
  return {
    targets,
    includeResult: typeof obj['includeResult'] === 'boolean' ? obj['includeResult'] : undefined,
    template: typeof obj['template'] === 'string' ? obj['template'] : undefined,
  };
}

/** Parse failureAlert config from automation JSON. Returns undefined if absent. */
function parseFailureAlertConfig(raw: unknown, automationName: string): FailureAlertConfig | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (typeof raw !== 'object') {
    throw new RepoError(
      'CONFIG_VALIDATION_FAILED',
      `Automation "${automationName}" failureAlert: expected an object`,
    );
  }
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- object narrowed above
  const obj = raw as Record<string, unknown>;
  const targetsRaw = obj['targets'];
  if (!Array.isArray(targetsRaw) || targetsRaw.length === 0) {
    throw new RepoError(
      'CONFIG_VALIDATION_FAILED',
      `Automation "${automationName}" failureAlert.targets: expected a non-empty array`,
    );
  }
  const targets: DeliveryTarget[] = [];
  for (const t of targetsRaw) {
    const target = parseDeliveryTarget(t, automationName);
    if (target) targets.push(target);
  }
  return {
    targets,
    after: typeof obj['after'] === 'number' && obj['after'] > 0 ? obj['after'] : undefined,
    cooldownMinutes:
      typeof obj['cooldownMinutes'] === 'number' && obj['cooldownMinutes'] >= 0 ? obj['cooldownMinutes'] : undefined,
  };
}

/**
 * Backward-compatible: parse old markdown automation format.
 */
function parseAutomationMarkdown(
  content: string,
  name: string,
  location: string,
): LoadedAutomation {
  const titleMatch = /^#\s+(?:Automation:\s+)?(.+)$/m.exec(content);
  const title = titleMatch ? titleMatch[1].trim() : name;

  const scheduleMatch = /^Schedule:\s+(.+)$/m.exec(content);
  const schedule = scheduleMatch ? scheduleMatch[1].trim() : undefined;

  const sections = extractSections(content);
  const prompt = sections['Check'] ?? content;

  const isWebhook = /\bon\s+webhook\b/i.test(content);
  const trigger: 'cron' | 'webhook' | 'manual' = isWebhook ? 'webhook' : schedule ? 'cron' : 'manual';

  return {name, title, schedule, trigger, prompt, location};
}

/**
 * Parse an eval markdown file.
 */
export function parseEval(
  content: string,
  name: string,
  location: string,
): LoadedEval {
  // Extract title from first # heading
  const titleMatch = /^#\s+(?:Eval:\s+)?(.+)$/m.exec(content);
  const title = titleMatch ? titleMatch[1].trim() : name;

  // Description is text between first heading and first ## section
  let description = '';
  if (titleMatch) {
    const afterTitle = content.slice(titleMatch.index + titleMatch[0].length);
    const firstSection = afterTitle.search(/^##\s+/m);
    if (firstSection >= 0) {
      description = afterTitle.slice(0, firstSection).trim();
    } else {
      description = afterTitle.trim();
    }
  }

  const sections = extractSections(content);

  // Parse setup section
  const setupText = sections['Setup'] ?? '';
  const appMatch = /^App:\s+(.+)$/m.exec(setupText);
  const contextMatch = /^Context:\s+(.+)$/m.exec(setupText);
  const setup = {
    app: appMatch ? appMatch[1].trim() : undefined,
    context: contextMatch ? contextMatch[1].trim() : undefined,
  };

  // Parse query — strip surrounding quotes
  let query = (sections['Query'] ?? '').trim();
  const quoteMatch = /^"(.+)"$/s.exec(query);
  if (quoteMatch) {
    query = quoteMatch[1]!;
  }

  // Parse assertions
  const assertionsText = sections['Assertions'] ?? '';
  const assertions = parseAssertions(assertionsText);

  return {
    name,
    title,
    description,
    setup,
    query,
    assertions,
    raw: content,
    location,
  };
}

/**
 * Extract named ## sections from markdown content.
 */
function extractSections(content: string): Record<string, string> {
  const sections: Record<string, string> = {};
  const sectionRe = /^##\s+(.+)$/gm;
  let match: RegExpExecArray | null;
  const boundaries: Array<{name: string; start: number}> = [];

  while ((match = sectionRe.exec(content)) !== null) {
    boundaries.push({
      name: match[1].trim(),
      start: match.index + match[0].length,
    });
  }

  for (let i = 0; i < boundaries.length; i++) {
    const boundary = boundaries[i];
    const end = i + 1 < boundaries.length ? boundaries[i + 1].start - boundaries[i + 1].name.length - 3 : content.length;
    sections[boundary.name] = content.slice(boundary.start, end).trim();
  }

  return sections;
}

/**
 * Parse assertion lines from an assertions section.
 * Lines starting with "- Should NOT" are negated.
 * Lines starting with "- Should" are positive.
 * Lines starting with "- " are treated as positive assertions.
 */
// Regex for agent heading: # Agent: Name
const AGENT_HEADING_RE = /^#\s+Agent:\s+(.+)$/m;

/**
 * Parse AGENT.md content into a LoadedAgent.
 *
 * Supports heading-based and frontmatter formats (same patterns as skills).
 *
 * Heading-based:
 * ```
 * # Agent: Compliance Checker
 *
 * Checks regulatory compliance across transactions.
 *
 * ## Prompt
 *
 * Load compliance KB docs and check the requested entities...
 * ```
 *
 * Frontmatter:
 * ```
 * ---
 * name: compliance-checker
 * displayName: Compliance Checker
 * description: Checks regulatory compliance
 * tools: [shell_exec, load_knowledge]
 * maxDepth: 1
 * maxToolCalls: 10
 * timeout: 30
 * modelTier: simple
 * ---
 *
 * Load compliance KB docs and check...
 * ```
 */
export function parseAgent(
  content: string,
  dirName: string,
  location: string,
): LoadedAgent | null {
  // Try heading-based format first
  const headingMatch = AGENT_HEADING_RE.exec(content);
  if (headingMatch) {
    const displayName = headingMatch[1].trim();
    const afterHeading = content.slice(headingMatch.index + headingMatch[0].length);
    const sections = extractSections(content);

    // Description is text between heading and first ## section
    const firstSectionIdx = afterHeading.search(/^##\s+/m);
    let description = '';
    if (firstSectionIdx >= 0) {
      description = afterHeading.slice(0, firstSectionIdx).trim();
    }

    // Prompt is in ## Prompt section, or the full body after heading
    const prompt = sections['Prompt'] ?? (firstSectionIdx >= 0
      ? afterHeading.slice(firstSectionIdx).trim()
      : afterHeading.trim());

    // Parse optional config from ## Config section (YAML)
    const configSection = sections['Config'];
    const agentConfig = configSection ? parseAgentConfigYaml(configSection) : {};

    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
    const cfgTools = Array.isArray(agentConfig['tools']) ? agentConfig['tools'] as string[] : ['shell_exec', 'load_knowledge'];
    const cfgMaxDepth = typeof agentConfig['maxDepth'] === 'number' ? agentConfig['maxDepth'] : 1;
    const cfgMaxToolCalls = typeof agentConfig['maxToolCalls'] === 'number' ? agentConfig['maxToolCalls'] : 10;
    const cfgTimeout = typeof agentConfig['timeout'] === 'number' ? agentConfig['timeout'] : 20;
    const cfgOutputMin = typeof agentConfig['targetOutputMin'] === 'number' ? agentConfig['targetOutputMin'] : 200;
    const cfgOutputMax = typeof agentConfig['targetOutputMax'] === 'number' ? agentConfig['targetOutputMax'] : 400;
    const cfgModelTier = typeof agentConfig['modelTier'] === 'string' && ['default', 'simple', 'advanced'].includes(agentConfig['modelTier'])
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      ? agentConfig['modelTier'] as 'default' | 'simple' | 'advanced'
      : undefined;

    return {
      name: dirName,
      displayName,
      description: description || displayName,
      prompt,
      tools: cfgTools,
      maxDepth: cfgMaxDepth,
      maxToolCalls: cfgMaxToolCalls,
      timeout: cfgTimeout,
      targetOutputMin: cfgOutputMin,
      targetOutputMax: cfgOutputMax,
      modelTier: cfgModelTier,
      location,
    };
  }

  // Try frontmatter format
  const fmMatch = FRONTMATTER_RE.exec(content);
  if (fmMatch) {
    try {
      const parsed = yaml.load(fmMatch[1]);
      if (parsed && typeof parsed === 'object') {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
        const fm = parsed as Record<string, unknown>;
        const displayName = typeof fm['displayName'] === 'string'
          ? fm['displayName']
          : (typeof fm['name'] === 'string' ? fm['name'] : dirName);
        const description = typeof fm['description'] === 'string' ? fm['description'] : displayName;
        const prompt = (fmMatch[2] ?? '').trim();
        if (!prompt) return null;

        return {
          name: dirName,
          displayName,
          description,
          prompt,
          tools: Array.isArray(fm['tools'])
            // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
            ? (fm['tools'] as string[])
            : ['shell_exec', 'load_knowledge'],
          maxDepth: typeof fm['maxDepth'] === 'number' ? fm['maxDepth'] : 1,
          maxToolCalls: typeof fm['maxToolCalls'] === 'number' ? fm['maxToolCalls'] : 10,
          timeout: typeof fm['timeout'] === 'number' ? fm['timeout'] : 20,
          targetOutputMin: typeof fm['targetOutputMin'] === 'number' ? fm['targetOutputMin'] : 200,
          targetOutputMax: typeof fm['targetOutputMax'] === 'number' ? fm['targetOutputMax'] : 400,
          modelTier: typeof fm['modelTier'] === 'string' && ['default', 'simple', 'advanced'].includes(fm['modelTier'])
            // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
            ? (fm['modelTier'] as 'default' | 'simple' | 'advanced')
            : undefined,
          location,
        };
      }
    } catch {
      // YAML parse failed
    }
    return null;
  }

  // Plain markdown — treat entire content as the prompt
  return {
    name: dirName,
    displayName: dirName,
    description: dirName,
    prompt: content.trim(),
    tools: ['shell_exec', 'load_knowledge'],
    maxDepth: 1,
    maxToolCalls: 10,
    timeout: 20,
    targetOutputMin: 200,
    targetOutputMax: 400,
    location,
  };
}

/**
 * Parse agent config from a YAML block inside a ## Config section.
 */
function parseAgentConfigYaml(text: string): Record<string, unknown> {
  try {
    const parsed = yaml.load(text);
    if (parsed && typeof parsed === 'object') {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      return parsed as Record<string, unknown>;
    }
  } catch {
    // Ignore parse failures
  }
  return {};
}

function parseAssertions(text: string): Array<{text: string; negated: boolean}> {
  const assertions: Array<{text: string; negated: boolean}> = [];
  const lines = text.split('\n');

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('- ')) continue;

    const assertionText = trimmed.slice(2).trim();
    if (!assertionText) continue;

    const negated = /^Should\s+(?:NOT|not)\s+/i.test(assertionText);
    assertions.push({text: assertionText, negated});
  }

  return assertions;
}
