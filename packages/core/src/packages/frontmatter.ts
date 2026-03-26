/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import yaml from 'js-yaml';

import {PackageError} from './package-error.js';

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---/;

/**
 * Result of parsing a markdown file with optional YAML frontmatter.
 */
export interface ParsedMarkdown {
  frontmatter: Record<string, unknown> | null;
  body: string;
}

/**
 * Parse YAML frontmatter from a markdown string.
 */
export function parseMarkdownFrontmatter(content: string): ParsedMarkdown {
  const match = FRONTMATTER_RE.exec(content);
  if (!match) {
    return {frontmatter: null, body: content};
  }

  const yamlStr = match[1];
  const afterFrontmatter = content.slice(match[0].length);
  // Strip leading newlines after the closing ---
  const body = afterFrontmatter.replace(/^\r?\n/, '');

  if (!yamlStr.trim()) {
    return {frontmatter: {}, body};
  }

  let parsed: unknown;
  try {
    parsed = yaml.load(yamlStr);
  } catch (err) {
    throw new PackageError('INVALID_FRONTMATTER', 'Failed to parse YAML frontmatter', err);
  }

  if (parsed === null || parsed === undefined) {
    return {frontmatter: {}, body};
  }

  if (typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new PackageError('INVALID_FRONTMATTER', 'Frontmatter must be a YAML mapping');
  }

  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
  return {frontmatter: parsed as Record<string, unknown>, body};
}

/**
 * Parse a JSON string that may contain an "import" key.
 * Returns the import name (if present) and the data without the import key.
 */
export function parseJsonImport(jsonString: string): {import?: string; data: Record<string, unknown>} {
  let raw: unknown;
  try {
    raw = JSON.parse(jsonString);
  } catch (err) {
    throw new PackageError('PARSE_FAILED', 'Invalid JSON', err);
  }

  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new PackageError('PARSE_FAILED', 'JSON must be an object');
  }

  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
  const obj = raw as Record<string, unknown>;
  const importName = typeof obj['import'] === 'string' ? obj['import'] : undefined;

  // Return data without the import key
  const data: Record<string, unknown> = {};
  for (const key of Object.keys(obj)) {
    if (key !== 'import') {
      data[key] = obj[key];
    }
  }

  return {import: importName, data};
}

/**
 * Validate that surface frontmatter does not have both "only" and "exclude".
 */
export function validateSurfaceFrontmatter(fm: Record<string, unknown>): void {
  const hasOnly = Array.isArray(fm['only']) && fm['only'].length > 0;
  const hasExclude = Array.isArray(fm['exclude']) && fm['exclude'].length > 0;

  if (hasOnly && hasExclude) {
    throw new PackageError(
      'CONFLICTING_FILTER',
      'surface.md frontmatter cannot have both "only" and "exclude" — use one or neither',
    );
  }
}
