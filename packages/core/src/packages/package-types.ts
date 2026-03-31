/**
 * @license
 * Copyright 2025 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import {z} from 'zod';

import {PackageError} from './package-error.js';

// --- Auth schemas (used by connection packages) ---

export const OAuth2AuthSchema = z.object({
  type: z.literal('oauth2'),
  authorizeUrl: z.string().min(1),
  tokenUrl: z.string().min(1),
  scopes: z.array(z.string()).optional(),
  envVars: z.record(z.string(), z.string()).optional(),
});

export const BearerAuthSchema = z.object({
  type: z.literal('bearer'),
  envVars: z.record(z.string(), z.string()).optional(),
});

export const ApiKeyAuthSchema = z.object({
  type: z.literal('api_key'),
  headers: z.record(z.string(), z.string()).optional(),
  envVars: z.record(z.string(), z.string()).optional(),
});

export const PackageAuthSchema = z.discriminatedUnion('type', [
  OAuth2AuthSchema,
  BearerAuthSchema,
  ApiKeyAuthSchema,
]);
export type PackageAuth = z.infer<typeof PackageAuthSchema>;

// --- Package manifest ---

/**
 * Known content directories that a package can contain.
 * Used by `amodal publish` to auto-populate the `contains` field.
 */
export const KNOWN_CONTENT_DIRS = [
  'connections',
  'skills',
  'automations',
  'knowledge',
  'stores',
  'tools',
  'pages',
  'agents',
  'evals',
] as const;

/**
 * Package manifest — lives in package.json under the "amodal" key.
 *
 * A package can contain any combination of amodal directories.
 * Two classification axes:
 * - `contains`: structural — what kinds of content are in the package
 *   (auto-populated by `amodal publish` from directory scan)
 * - `tags`: topical — what domain/use-case the package is for
 *   (user-curated for discovery)
 */
export const PackageManifestSchema = z.object({
  name: z.string().min(1),
  contains: z.array(z.string()).optional(),
  tags: z.array(z.string()).optional(),
  description: z.string().optional(),
  // Connection-specific fields
  auth: PackageAuthSchema.optional(),
  testEndpoints: z.array(z.string()).optional(),
  // MCP-specific fields
  transport: z.enum(['stdio', 'sse', 'http']).optional(),
  url: z.string().optional(),
  command: z.string().optional(),
  args: z.array(z.string()).optional(),
  env: z.record(z.string()).optional(),
  trust: z.boolean().optional(),
});
export type PackageManifest = z.infer<typeof PackageManifestSchema>;

// --- Lock file ---

/**
 * A single lock file entry for an installed package.
 * Keyed by npm package name (e.g., "@amodalai/alert-enrichment").
 */
export const LockEntrySchema = z.object({
  version: z.string().min(1),
  integrity: z.string(),
});
export type LockEntry = z.infer<typeof LockEntrySchema>;

/**
 * The lock file schema (amodal.lock).
 */
export const LockFileSchema = z.object({
  lockVersion: z.literal(2),
  packages: z.record(z.string(), LockEntrySchema),
});
export type LockFile = z.infer<typeof LockFileSchema>;

// --- Naming helpers ---

const AMODAL_SCOPE = '@amodalai/';

/**
 * Normalize a package name to a full npm name.
 * "alert-enrichment" → "@amodalai/alert-enrichment"
 * "@amodalai/alert-enrichment" → "@amodalai/alert-enrichment"
 */
export function toNpmName(name: string): string {
  if (name.startsWith('@')) return name;
  return `${AMODAL_SCOPE}${name}`;
}

/**
 * Extract the short name from an npm package name.
 * "@amodalai/alert-enrichment" → "alert-enrichment"
 */
export function fromNpmName(npm: string): string {
  if (!npm.startsWith(AMODAL_SCOPE)) {
    throw new PackageError('PARSE_FAILED', `Not an amodal package name: ${npm}`);
  }
  return npm.slice(AMODAL_SCOPE.length);
}

/**
 * Check if a string is an amodal scoped package name.
 */
export function isAmodalPackage(npm: string): boolean {
  return npm.startsWith(AMODAL_SCOPE);
}
