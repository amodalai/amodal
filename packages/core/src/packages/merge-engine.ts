/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import type {AccessConfig, EndpointAccess, FieldRestriction} from '../repo/connection-schemas.js';
import {AccessConfigSchema, ConnectionSpecSchema} from '../repo/connection-schemas.js';
import type {ConnectionSpec} from '../repo/connection-schemas.js';
import type {SurfaceEndpoint} from '../repo/connection-types.js';
import {parseSurface} from '../repo/surface-parser.js';

import {parseJsonImport, parseMarkdownFrontmatter, validateSurfaceFrontmatter} from './frontmatter.js';
import {PackageError} from './package-error.js';

// --- spec.json merge: deep merge, local wins, arrays replaced ---

/**
 * Deep merge two objects. Local values win. Arrays are replaced entirely.
 */
export function deepMergeLocalWins(
  base: Record<string, unknown>,
  local: Record<string, unknown>,
): Record<string, unknown> {
  const result: Record<string, unknown> = {...base};

  for (const key of Object.keys(local)) {
    const baseVal = base[key];
    const localVal = local[key];

    if (
      localVal !== null &&
      typeof localVal === 'object' &&
      !Array.isArray(localVal) &&
      baseVal !== null &&
      typeof baseVal === 'object' &&
      !Array.isArray(baseVal)
    ) {
      // Recurse for nested objects
      result[key] = deepMergeLocalWins(
        // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
        baseVal as Record<string, unknown>,
        // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
        localVal as Record<string, unknown>,
      );
    } else {
      // Local wins (arrays replaced entirely)
      result[key] = localVal;
    }
  }

  return result;
}

/**
 * Merge a local spec.json override on top of a package base.
 */
export function mergeSpecJson(baseJson: string, localJson: string): ConnectionSpec {
  const {data: localData} = parseJsonImport(localJson);
  let baseRaw: unknown;
  try {
    baseRaw = JSON.parse(baseJson);
  } catch (err) {
    throw new PackageError('PARSE_FAILED', 'Invalid JSON in base spec.json', err);
  }

  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
  const merged = deepMergeLocalWins(baseRaw as Record<string, unknown>, localData);
  return ConnectionSpecSchema.parse(merged);
}

// --- surface.md merge: filtered base + local additions ---

type ConfirmTier = undefined | true | 'review' | 'never';

const CONFIRM_RANK: Record<string, number> = {
  undefined: 0,
  true: 1,
  review: 2,
  never: 3,
};

/**
 * Filter endpoints by only/exclude lists from frontmatter.
 */
export function filterEndpoints(
  endpoints: SurfaceEndpoint[],
  frontmatter: Record<string, unknown>,
): SurfaceEndpoint[] {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
  const only = frontmatter['only'] as string[] | undefined;
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
  const exclude = frontmatter['exclude'] as string[] | undefined;

  if (Array.isArray(only) && only.length > 0) {
    const set = new Set(only);
    return endpoints.filter((ep) => set.has(`${ep.method} ${ep.path}`));
  }

  if (Array.isArray(exclude) && exclude.length > 0) {
    const set = new Set(exclude);
    return endpoints.filter((ep) => !set.has(`${ep.method} ${ep.path}`));
  }

  return endpoints;
}

const ENDPOINT_HEADING_RE = /^###\s+(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\s+(\S+)/;

/**
 * Merge a local surface.md override on top of a package base.
 */
export function mergeSurface(baseMd: string, localMd: string): string {
  const {frontmatter, body} = parseMarkdownFrontmatter(localMd);

  if (frontmatter) {
    validateSurfaceFrontmatter(frontmatter);
  }

  // Parse and filter base endpoints
  let baseEndpoints = parseSurface(baseMd);
  if (frontmatter) {
    baseEndpoints = filterEndpoints(baseEndpoints, frontmatter);
  }

  // Build local endpoint sections
  const localSections = new Map<string, string>();
  let currentKey: string | null = null;
  const currentLines: string[] = [];
  const nonEndpointLines: string[] = [];
  let foundEndpoint = false;

  for (const line of body.split('\n')) {
    const match = ENDPOINT_HEADING_RE.exec(line);
    if (match) {
      if (currentKey) {
        localSections.set(currentKey, currentLines.join('\n').trim());
        currentLines.length = 0;
      }
      currentKey = `${match[1]} ${match[2]}`;
      foundEndpoint = true;
    } else if (currentKey) {
      currentLines.push(line);
    } else if (!foundEndpoint) {
      // Lines before any ### endpoint heading
      nonEndpointLines.push(line);
    }
  }
  if (currentKey) {
    localSections.set(currentKey, currentLines.join('\n').trim());
  }

  // Build output
  const outputParts: string[] = [];

  // Render base endpoints, appending local additions if they match
  for (const ep of baseEndpoints) {
    const key = `${ep.method} ${ep.path}`;
    let section = `### ${ep.method} ${ep.path}`;
    if (ep.description) {
      section += `\n${ep.description}`;
    }
    const localAddition = localSections.get(key);
    if (localAddition) {
      section += `\n${localAddition}`;
      localSections.delete(key);
    }
    outputParts.push(section);
  }

  // Append remaining local sections that didn't match base endpoints
  for (const [key, content] of localSections) {
    let section = `### ${key}`;
    if (content) {
      section += `\n${content}`;
    }
    outputParts.push(section);
  }

  let result = outputParts.join('\n\n');

  // Prepend non-endpoint content from local body
  const preamble = nonEndpointLines.join('\n').trim();
  if (preamble) {
    result = preamble + '\n\n' + result;
  }

  return result.trim();
}

// --- access.json merge: additive, restrictions only tighten ---

function confirmRank(tier: ConfirmTier): number {
  return CONFIRM_RANK[String(tier)] ?? 0;
}

/**
 * Return the tighter of two confirmation tiers.
 */
export function tighterConfirm(base: ConfirmTier, local: ConfirmTier): ConfirmTier {
  if (confirmRank(local) > confirmRank(base)) return local;
  return base;
}

type FieldPolicy = 'role_gated' | 'retrieve_but_redact' | 'never_retrieve';

const POLICY_RANK: Record<string, number> = {
  role_gated: 0,
  retrieve_but_redact: 1,
  never_retrieve: 2,
};

/**
 * Return the tighter of two field restriction policies.
 */
export function tighterPolicy(base: FieldPolicy, local: FieldPolicy): FieldPolicy {
  const baseRank = POLICY_RANK[base] ?? 0;
  const localRank = POLICY_RANK[local] ?? 0;
  return localRank > baseRank ? local : base;
}

/**
 * Narrow roles by intersection. undefined means "no restriction" (all roles).
 */
export function narrowRoles(base?: string[], local?: string[]): string[] | undefined {
  if (!base) return local;
  if (!local) return base;
  // Intersection
  const baseSet = new Set(base);
  return local.filter((r) => baseSet.has(r));
}

/**
 * Merge a local access.json override on top of a package base.
 * Local overrides take precedence — the user's repo is the final word.
 */
export function mergeAccessJson(baseJson: string, localJson: string): AccessConfig {
  const {data: localData} = parseJsonImport(localJson);
  let baseRaw: unknown;
  try {
    baseRaw = JSON.parse(baseJson);
  } catch (err) {
    throw new PackageError('PARSE_FAILED', 'Invalid JSON in base access.json', err);
  }

  const base = AccessConfigSchema.parse(baseRaw);

  // Merge endpoints
  const mergedEndpoints: Record<string, EndpointAccess> = {...base.endpoints};
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
  const localEndpoints = localData['endpoints'] as Record<string, Partial<EndpointAccess>> | undefined;

  if (localEndpoints) {
    for (const [ep, localAccess] of Object.entries(localEndpoints)) {
      const baseAccess = mergedEndpoints[ep];
      if (!baseAccess) {
        // New endpoint — add it directly (local defines new restrictions)
        // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
        mergedEndpoints[ep] = localAccess as EndpointAccess;
      } else {
        // Local override wins — merge base fields, then apply local on top
        mergedEndpoints[ep] = {
          ...baseAccess,
          ...localAccess,
        };
        // If local explicitly omits confirm (undefined), remove it from merged
        if (localAccess.confirm === undefined && 'confirm' in localAccess) {
          delete mergedEndpoints[ep].confirm;
        } else if (localAccess.confirm !== undefined) {
          mergedEndpoints[ep].confirm = localAccess.confirm;
        }
        if (localAccess.thresholds) {
          mergedEndpoints[ep].thresholds = [
            ...(baseAccess.thresholds ?? []),
            ...localAccess.thresholds,
          ];
        }
      }
    }
  }

  // Merge field restrictions
  const baseRestrictions = base.fieldRestrictions ?? [];
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
  const localRestrictions = (localData['fieldRestrictions'] ?? []) as Array<Record<string, unknown>>;

  const mergedRestrictions = [...baseRestrictions];

  for (const localRestr of localRestrictions) {
    const entity = String(localRestr['entity'] ?? '');
    const field = String(localRestr['field'] ?? '');

    // Find matching base restriction
    const existingIdx = mergedRestrictions.findIndex(
      (r) => r.entity === entity && r.field === field,
    );

    if (existingIdx >= 0) {
      const existing = mergedRestrictions[existingIdx];
      // Local override wins for policy and roles
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      const newPolicy = (localRestr['policy'] as FieldPolicy | undefined) ?? existing.policy;
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      const newRoles = (localRestr['allowedRoles'] as string[] | undefined) ?? existing.allowedRoles;
      mergedRestrictions[existingIdx] = {
        ...existing,
        policy: newPolicy,
        allowedRoles: newRoles,
      };
    } else {
      // New restriction — add it
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      mergedRestrictions.push(localRestr as unknown as FieldRestriction);
    }
  }

  const result: AccessConfig = {
    ...base,
    endpoints: mergedEndpoints,
    fieldRestrictions: mergedRestrictions.length > 0 ? mergedRestrictions : undefined,
  };

  // Merge delegations if local provides them
  if (localData['delegations']) {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
    result.delegations = localData['delegations'] as AccessConfig['delegations'];
  }

  // Merge alternativeLookups additively
  if (localData['alternativeLookups']) {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
    const localLookups = localData['alternativeLookups'] as AccessConfig['alternativeLookups'];
    result.alternativeLookups = [
      ...(base.alternativeLookups ?? []),
      ...(localLookups ?? []),
    ];
  }

  return result;
}

// --- entities.md merge: section-level by ### heading ---

/**
 * Extract ### heading sections from markdown content.
 * Returns a Map of heading text → section content (without the heading line).
 * Also returns the preamble (content before the first ### heading).
 */
export function extractHeadingSections(
  content: string,
): {preamble: string; sections: Map<string, string>} {
  const lines = content.split('\n');
  const sections = new Map<string, string>();
  const preambleLines: string[] = [];
  let currentHeading: string | null = null;
  const currentLines: string[] = [];

  for (const line of lines) {
    const headingMatch = /^###\s+(.+)/.exec(line);
    if (headingMatch) {
      if (currentHeading) {
        sections.set(currentHeading, currentLines.join('\n').trim());
        currentLines.length = 0;
      }
      currentHeading = headingMatch[1].trim();
    } else if (currentHeading) {
      currentLines.push(line);
    } else {
      preambleLines.push(line);
    }
  }
  if (currentHeading) {
    sections.set(currentHeading, currentLines.join('\n').trim());
  }

  return {preamble: preambleLines.join('\n').trim(), sections};
}

/**
 * Merge entities.md: local ### sections replace matching base sections.
 * Unmatched base sections pass through.
 */
export function mergeEntities(baseMd: string, localMd: string): string {
  const {body} = parseMarkdownFrontmatter(localMd);
  const baseParsed = extractHeadingSections(baseMd);
  const localParsed = extractHeadingSections(body);

  // Start with base sections, replace with local where present
  const mergedSections = new Map<string, string>(baseParsed.sections);
  for (const [heading, content] of localParsed.sections) {
    mergedSections.set(heading, content);
  }

  const parts: string[] = [];
  if (baseParsed.preamble) {
    parts.push(baseParsed.preamble);
  }
  for (const [heading, content] of mergedSections) {
    parts.push(`### ${heading}\n${content}`);
  }

  return parts.join('\n\n').trim();
}

// --- Concatenation merge (rules, skills, automations, knowledge) ---

/**
 * Concatenate package base with local additions.
 * Package content first, blank line separator, local body (frontmatter stripped).
 */
export function mergeConcatenation(baseMd: string, localMd: string): string {
  const {body} = parseMarkdownFrontmatter(localMd);
  const baseContent = baseMd.trim();
  const localContent = body.trim();

  if (!localContent) return baseContent;
  if (!baseContent) return localContent;

  return `${baseContent}\n\n${localContent}`;
}
