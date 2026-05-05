/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import {readFile} from 'node:fs/promises';
import * as path from 'node:path';

import type {AgentCard, AgentCardPreview} from '@amodalai/types';

import {RepoError} from '../repo/repo-types.js';
import {AgentCardSchema, AgentCardPreviewSchema} from './card-schemas.js';

/**
 * Convention: a template surfaces in the gallery by including a `card/`
 * directory at its root with `card.json` (thumbnail) and optionally
 * `preview.json` (expanded view).
 */
export const CARD_DIR = 'card';
export const CARD_FILE = 'card.json';
export const PREVIEW_FILE = 'preview.json';

/**
 * Parse and validate a `card.json` JSON string.
 *
 * Throws RepoError with code CONFIG_PARSE_FAILED for malformed JSON, or
 * CONFIG_VALIDATION_FAILED if the parsed object doesn't match the schema.
 */
export function parseAgentCardJson(
  jsonString: string,
  fileLabel: string,
): AgentCard {
  let raw: unknown;
  try {
    raw = JSON.parse(jsonString);
  } catch (err) {
    throw new RepoError(
      'CONFIG_PARSE_FAILED',
      `Invalid JSON in card file "${fileLabel}"`,
      err,
    );
  }

  const parsed = AgentCardSchema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `${i.path.join('.')}: ${i.message}`)
      .join('; ');
    throw new RepoError(
      'CONFIG_VALIDATION_FAILED',
      `Invalid agent card "${fileLabel}": ${issues}`,
    );
  }

  return parsed.data;
}

/**
 * Parse and validate a `preview.json` JSON string.
 */
export function parseAgentCardPreviewJson(
  jsonString: string,
  fileLabel: string,
): AgentCardPreview {
  let raw: unknown;
  try {
    raw = JSON.parse(jsonString);
  } catch (err) {
    throw new RepoError(
      'CONFIG_PARSE_FAILED',
      `Invalid JSON in preview file "${fileLabel}"`,
      err,
    );
  }

  const parsed = AgentCardPreviewSchema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `${i.path.join('.')}: ${i.message}`)
      .join('; ');
    throw new RepoError(
      'CONFIG_VALIDATION_FAILED',
      `Invalid agent card preview "${fileLabel}": ${issues}`,
    );
  }

  return parsed.data;
}

/**
 * Read and validate `<templateRoot>/card/card.json`.
 *
 * Returns null if the file is absent — a template without a card simply
 * doesn't surface in the gallery.
 */
export async function loadAgentCard(
  templateRoot: string,
): Promise<AgentCard | null> {
  const filePath = path.join(templateRoot, CARD_DIR, CARD_FILE);
  let content: string;
  try {
    content = await readFile(filePath, 'utf-8');
  } catch (err) {
    if (isFileNotFound(err)) return null;
    throw new RepoError(
      'READ_FAILED',
      `Failed to read agent card at ${filePath}`,
      err,
    );
  }
  return parseAgentCardJson(content, filePath);
}

/**
 * Read and validate `<templateRoot>/card/preview.json`. Returns null when
 * absent — preview is optional; the thumbnail can serve as the expanded view.
 */
export async function loadAgentCardPreview(
  templateRoot: string,
): Promise<AgentCardPreview | null> {
  const filePath = path.join(templateRoot, CARD_DIR, PREVIEW_FILE);
  let content: string;
  try {
    content = await readFile(filePath, 'utf-8');
  } catch (err) {
    if (isFileNotFound(err)) return null;
    throw new RepoError(
      'READ_FAILED',
      `Failed to read agent card preview at ${filePath}`,
      err,
    );
  }
  return parseAgentCardPreviewJson(content, filePath);
}

function isFileNotFound(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as {code: unknown}).code === 'ENOENT'
  );
}
