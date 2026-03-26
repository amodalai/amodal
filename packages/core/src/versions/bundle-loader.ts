/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import { readFile } from 'node:fs/promises';
import { ZodError } from 'zod';
import { VersionBundleSchema } from './version-bundle-types.js';
import type { VersionBundle } from './version-bundle-types.js';

/**
 * Error codes for bundle loading failures.
 */
export type VersionBundleErrorCode =
  | 'FETCH_FAILED'
  | 'PARSE_FAILED'
  | 'VALIDATION_FAILED';

/**
 * Error thrown when a version bundle cannot be loaded.
 */
export class VersionBundleError extends Error {
  readonly code: VersionBundleErrorCode;

  constructor(code: VersionBundleErrorCode, message: string, cause?: unknown) {
    super(message, { cause });
    this.name = 'VersionBundleError';
    this.code = code;
  }
}

/**
 * Source for loading a bundle — either a URL or a local file path.
 */
export interface BundleSource {
  url?: string;
  path?: string;
}

/**
 * Load a version bundle from a remote URL.
 */
export async function loadBundleFromUrl(
  url: string,
  timeout = 30000,
): Promise<VersionBundle> {
  let response: Response;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    response = await fetch(url, { signal: controller.signal });
    clearTimeout(timer);
  } catch (err) {
    throw new VersionBundleError(
      'FETCH_FAILED',
      `Failed to fetch bundle from ${url}`,
      err,
    );
  }

  if (!response.ok) {
    throw new VersionBundleError(
      'FETCH_FAILED',
      `HTTP ${String(response.status)} fetching bundle from ${url}`,
    );
  }

  let data: unknown;
  try {
    data = await response.json();
  } catch (err) {
    throw new VersionBundleError(
      'PARSE_FAILED',
      `Invalid JSON in bundle from ${url}`,
      err,
    );
  }

  return validateBundle(data);
}

/**
 * Load a version bundle from a local file.
 */
export async function loadBundleFromFile(
  filePath: string,
): Promise<VersionBundle> {
  let raw: string;
  try {
    raw = await readFile(filePath, 'utf-8');
  } catch (err) {
    throw new VersionBundleError(
      'FETCH_FAILED',
      `Failed to read bundle file: ${filePath}`,
      err,
    );
  }

  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch (err) {
    throw new VersionBundleError(
      'PARSE_FAILED',
      `Invalid JSON in bundle file: ${filePath}`,
      err,
    );
  }

  return validateBundle(data);
}

/**
 * Load a bundle from either a URL or file path.
 * Exactly one of `url` or `path` must be provided.
 */
export async function loadBundle(source: BundleSource): Promise<VersionBundle> {
  if (source.url && source.path) {
    throw new VersionBundleError(
      'VALIDATION_FAILED',
      'Provide either url or path, not both',
    );
  }
  if (source.url) {
    return loadBundleFromUrl(source.url);
  }
  if (source.path) {
    return loadBundleFromFile(source.path);
  }
  throw new VersionBundleError(
    'VALIDATION_FAILED',
    'Either url or path must be provided',
  );
}

/**
 * Validate raw data against the VersionBundle schema.
 */
function validateBundle(data: unknown): VersionBundle {
  try {
    return VersionBundleSchema.parse(data);
  } catch (err) {
    if (err instanceof ZodError) {
      const issues = err.issues
        .map((i) => `${i.path.join('.')}: ${i.message}`)
        .join('; ');
      throw new VersionBundleError(
        'VALIDATION_FAILED',
        `Bundle validation failed: ${issues}`,
        err,
      );
    }
    throw new VersionBundleError(
      'VALIDATION_FAILED',
      'Bundle validation failed',
      err,
    );
  }
}
