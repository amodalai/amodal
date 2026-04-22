/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import {z} from 'zod';

/** Regex for valid store names — kebab-case, starts with lowercase letter */
export const STORE_NAME_REGEX = /^[a-z][a-z0-9-]*$/;

/**
 * Zod schema for a store field definition (recursive for nested types).
 */
export const StoreFieldDefinitionSchema: z.ZodType<{
  type: string;
  nullable?: boolean;
  values?: string[];
  min?: number;
  max?: number;
  item?: unknown;
  fields?: Record<string, unknown>;
  store?: string;
}> = z.lazy(() =>
  z.object({
    type: z.enum(['string', 'number', 'boolean', 'datetime', 'enum', 'array', 'object', 'ref']),
    nullable: z.boolean().optional(),
    values: z.array(z.string()).optional(),
    min: z.number().optional(),
    max: z.number().optional(),
    item: StoreFieldDefinitionSchema.optional(),
    fields: z.record(StoreFieldDefinitionSchema).optional(),
    store: z.string().optional(),
  }).superRefine((field, ctx) => {
    if (field.type === 'enum' && (!field.values || field.values.length === 0)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Enum fields must have a non-empty "values" array',
      });
    }
    if (field.type === 'array' && !field.item) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Array fields must have an "item" definition',
      });
    }
    if (field.type === 'object' && !field.fields) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Object fields must have a "fields" definition',
      });
    }
    if (field.type === 'ref' && !field.store) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Ref fields must have a "store" target',
      });
    }
  }),
);

/**
 * Zod schema for a store entity definition.
 */
export const StoreEntitySchema = z.object({
  /** TypeScript type name (e.g., "ClassifiedAlert") */
  name: z.string().min(1),
  /** Key template (e.g., "{event_id}") */
  key: z.string().min(1),
  /** Field definitions */
  schema: z.record(StoreFieldDefinitionSchema),
});

/**
 * Zod schema for TTL configuration — either a number or conditional config.
 */
export const StoreTtlConfigSchema = z.union([
  z.number().int().positive(),
  z.object({
    default: z.number().int().positive(),
    override: z.array(z.object({
      condition: z.string().min(1),
      ttl: z.number().int().positive(),
    })).optional(),
  }),
]);

/**
 * Zod schema for failure handling configuration.
 */
export const StoreFailureConfigSchema = z.object({
  mode: z.enum(['partial', 'all-or-nothing', 'skip']),
  retries: z.number().int().nonnegative().optional(),
  backoff: z.enum(['exponential', 'linear', 'none']).optional(),
  deadLetter: z.boolean().optional(),
});

/**
 * Zod schema for history configuration.
 */
export const StoreHistoryConfigSchema = z.object({
  versions: z.number().int().positive(),
});

/**
 * Zod schema for a store JSON file (stores/*.json).
 */
export const StoreJsonSchema = z.object({
  /** Store name — kebab-case. Optional; defaults to filename. */
  name: z.string().regex(
    STORE_NAME_REGEX,
    'Store name must be kebab-case (lowercase letters, digits, hyphens), starting with a letter',
  ).optional(),
  /** Entity definition */
  entity: StoreEntitySchema,
  /** TTL configuration */
  ttl: StoreTtlConfigSchema.optional(),
  /** Failure handling */
  failure: StoreFailureConfigSchema.optional(),
  /** Version history */
  history: StoreHistoryConfigSchema.optional(),
  /** Whether to store reasoning traces */
  trace: z.boolean().optional(),
  /**
   * When true, this store is shared across all scope IDs (agent-level).
   * Reads use scopeId = '' (no isolation); writes are rejected.
   */
  shared: z.boolean().optional(),
});

export type StoreJson = z.infer<typeof StoreJsonSchema>;
