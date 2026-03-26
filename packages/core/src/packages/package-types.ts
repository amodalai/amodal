/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import {z} from 'zod';

import {PackageError} from './package-error.js';

/**
 * The four package types in the Amodal ecosystem.
 */
export const PackageTypeSchema = z.enum([
  'connection',
  'skill',
  'automation',
  'knowledge',
  'mcp',
]);
export type PackageType = z.infer<typeof PackageTypeSchema>;

/**
 * A single lock file entry for an installed package.
 */
export const LockEntrySchema = z.object({
  version: z.string().min(1),
  npm: z.string().min(1),
  integrity: z.string(),
});
export type LockEntry = z.infer<typeof LockEntrySchema>;

/**
 * The lock file schema (amodal.lock).
 */
export const LockFileSchema = z.object({
  lockVersion: z.literal(1),
  packages: z.record(z.string(), LockEntrySchema),
});
export type LockFile = z.infer<typeof LockFileSchema>;

// --- Auth schemas for connection manifests ---

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

// --- Package manifest schemas ---

export const ConnectionManifestSchema = z.object({
  type: z.literal('connection'),
  name: z.string().min(1),
  auth: PackageAuthSchema.optional(),
  testEndpoints: z.array(z.string()).optional(),
  entities: z.array(z.string()).optional(),
  endpointCount: z.number().optional(),
});

export const SkillManifestSchema = z.object({
  type: z.literal('skill'),
  name: z.string().min(1),
  requiredEntities: z.array(z.string()).optional(),
});

export const AutomationManifestSchema = z.object({
  type: z.literal('automation'),
  name: z.string().min(1),
});

export const KnowledgeManifestSchema = z.object({
  type: z.literal('knowledge'),
  name: z.string().min(1),
});

export const McpManifestSchema = z.object({
  type: z.literal('mcp'),
  name: z.string().min(1),
  transport: z.enum(['stdio', 'sse', 'http']).default('http'),
  url: z.string().optional(),
  command: z.string().optional(),
  args: z.array(z.string()).optional(),
  env: z.record(z.string()).optional(),
  trust: z.boolean().optional(),
});

export const PackageManifestSchema = z.discriminatedUnion('type', [
  ConnectionManifestSchema,
  SkillManifestSchema,
  AutomationManifestSchema,
  KnowledgeManifestSchema,
  McpManifestSchema,
]);
export type PackageManifest = z.infer<typeof PackageManifestSchema>;

// --- Naming convention helpers ---

/**
 * Reference to a package by type + name.
 */
export interface PackageRef {
  type: PackageType;
  name: string;
  key: string;
  npmName: string;
}

/**
 * Build a lock file key: "connection/salesforce"
 */
export function packageKey(type: PackageType, name: string): string {
  return `${type}/${name}`;
}

/**
 * Parse a lock file key back to type + name.
 */
export function parsePackageKey(key: string): {type: PackageType; name: string} {
  const slashIdx = key.indexOf('/');
  if (slashIdx < 0) {
    throw new PackageError('PARSE_FAILED', `Invalid package key: ${key}`);
  }
  const rawType = key.slice(0, slashIdx);
  const name = key.slice(slashIdx + 1);
  const result = PackageTypeSchema.safeParse(rawType);
  if (!result.success) {
    throw new PackageError('PARSE_FAILED', `Invalid package type in key: ${key}`);
  }
  return {type: result.data, name};
}

/**
 * Convert type + name to npm package name: "@amodalai/connection-salesforce"
 */
export function toNpmName(type: PackageType, name: string): string {
  return `@amodalai/${type}-${name}`;
}

/**
 * Parse an npm package name back to type + name.
 */
export function fromNpmName(npm: string): {type: PackageType; name: string} {
  const prefix = '@amodalai/';
  if (!npm.startsWith(prefix)) {
    throw new PackageError('PARSE_FAILED', `Not an amodal package name: ${npm}`);
  }
  const rest = npm.slice(prefix.length);
  // Find the first dash that separates type from name
  for (const t of PackageTypeSchema.options) {
    if (rest.startsWith(`${t}-`)) {
      return {type: t, name: rest.slice(t.length + 1)};
    }
  }
  throw new PackageError('PARSE_FAILED', `Cannot parse package type from: ${npm}`);
}

/**
 * Convert type + name to symlink directory name: "connection--salesforce"
 */
export function toSymlinkName(type: PackageType, name: string): string {
  return `${type}--${name}`;
}

/**
 * Build a full PackageRef from type + name.
 */
export function makePackageRef(type: PackageType, name: string): PackageRef {
  return {
    type,
    name,
    key: packageKey(type, name),
    npmName: toNpmName(type, name),
  };
}
