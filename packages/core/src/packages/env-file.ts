/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import {readFile, rename, writeFile} from 'node:fs/promises';

import {PackageError} from './package-error.js';

/**
 * Parse .env file content into a Map of key-value pairs.
 * Handles KEY=value, quoted values, and comments.
 */
export function parseEnvContent(content: string): Map<string, string> {
  const entries = new Map<string, string>();
  const lines = content.split('\n');

  for (const line of lines) {
    const trimmed = line.trim();
    // Skip empty lines and comments
    if (!trimmed || trimmed.startsWith('#')) continue;

    const eqIdx = trimmed.indexOf('=');
    if (eqIdx < 0) continue;

    const key = trimmed.slice(0, eqIdx).trim();
    if (!key) continue;

    let value = trimmed.slice(eqIdx + 1).trim();

    // Strip surrounding quotes
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    entries.set(key, value);
  }

  return entries;
}

/**
 * Serialize a Map of entries back to .env format.
 */
export function serializeEnvEntries(entries: Map<string, string>): string {
  const lines: string[] = [];
  for (const [key, value] of entries) {
    // Quote values that contain spaces, #, or special chars
    if (/[\s#"'\\]/.test(value)) {
      lines.push(`${key}="${value}"`);
    } else {
      lines.push(`${key}=${value}`);
    }
  }
  return lines.length > 0 ? lines.join('\n') + '\n' : '';
}

/**
 * Read and parse a .env file. Returns empty map if file doesn't exist.
 */
export async function readEnvFile(filePath: string): Promise<Map<string, string>> {
  try {
    const content = await readFile(filePath, 'utf-8');
    return parseEnvContent(content);
  } catch (err) {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return new Map();
    }
    throw new PackageError('ENV_READ_FAILED', `Failed to read ${filePath}`, err);
  }
}

/**
 * Upsert entries into a .env file.
 * Preserves existing comments and blank lines.
 * Updates values in-place for existing keys, appends new keys at end.
 */
export async function upsertEnvEntries(
  filePath: string,
  entries: Record<string, string>,
): Promise<void> {
  let existingContent = '';
  try {
    existingContent = await readFile(filePath, 'utf-8');
  } catch (err) {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw new PackageError('ENV_READ_FAILED', `Failed to read ${filePath}`, err);
    }
  }

  const remaining = new Map(Object.entries(entries));
  const lines = existingContent ? existingContent.split('\n') : [];
  const outputLines: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    // Check if this line is a key=value that we need to update
    if (trimmed && !trimmed.startsWith('#')) {
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx >= 0) {
        const key = trimmed.slice(0, eqIdx).trim();
        if (remaining.has(key)) {
          const newValue = remaining.get(key)!;
          remaining.delete(key);
          if (/[\s#"'\\]/.test(newValue)) {
            outputLines.push(`${key}="${newValue}"`);
          } else {
            outputLines.push(`${key}=${newValue}`);
          }
          continue;
        }
      }
    }
    outputLines.push(line);
  }

  // Append new entries
  for (const [key, value] of remaining) {
    if (/[\s#"'\\]/.test(value)) {
      outputLines.push(`${key}="${value}"`);
    } else {
      outputLines.push(`${key}=${value}`);
    }
  }

  let content = outputLines.join('\n');
  // Ensure trailing newline
  if (!content.endsWith('\n')) {
    content += '\n';
  }

  // Atomic write
  const tmpPath = `${filePath}.tmp`;
  try {
    await writeFile(tmpPath, content, 'utf-8');
    await rename(tmpPath, filePath);
  } catch (err) {
    throw new PackageError('ENV_WRITE_FAILED', `Failed to write ${filePath}`, err);
  }
}

/**
 * Find which required env vars are missing from a .env file.
 */
export async function findMissingEnvVars(
  envFilePath: string,
  required: string[],
): Promise<string[]> {
  const entries = await readEnvFile(envFilePath);
  return required.filter((key) => {
    const value = entries.get(key);
    return value === undefined || value === '';
  });
}

