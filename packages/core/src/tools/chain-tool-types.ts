/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import { z } from 'zod';
import { ResponseShapingSchema } from './http-tool-types.js';

/**
 * Schema for a single step in a chain tool.
 */
export const ChainStepSchema = z.object({
  /** Unique name for this step (used in merge template references) */
  name: z.string().min(1),
  /** HTTP method */
  method: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']),
  /** URL template with {{connections.x}} and {{params.x}} placeholders */
  urlTemplate: z.string().min(1),
  /** Header templates (values may contain {{}} expressions) */
  headers: z.record(z.string()).optional(),
  /** Body template for POST/PUT/PATCH — string or object (values resolved) */
  bodyTemplate: z.union([z.string(), z.record(z.unknown())]).optional(),
  /** Query parameter templates */
  queryParams: z.record(z.string()).optional(),
  /** Per-step timeout in milliseconds */
  timeout: z.number().int().positive().default(30000),
  /** Response shaping for this step's result before merging */
  responseShaping: ResponseShapingSchema.optional(),
});

/**
 * Schema for a chain tool configuration.
 */
export const ChainToolConfigSchema = z.object({
  /** Internal tool name */
  name: z.string().min(1),
  /** User-facing display name */
  displayName: z.string().min(1),
  /** Description shown to the LLM */
  description: z.string().min(1),
  /** Ordered list of steps to execute in parallel */
  steps: z.array(ChainStepSchema).min(1),
  /** Merge template combining step results. String or object with {{steps.NAME.path}} */
  merge: z.union([z.string(), z.record(z.unknown())]),
  /** JSON Schema describing parameters the LLM should provide */
  parameters: z.record(z.unknown()),
  /** Response shaping for the final merged result */
  responseShaping: ResponseShapingSchema.optional(),
  /** Aggregate timeout for all steps in milliseconds */
  timeout: z.number().int().positive().default(60000),
});

export type ChainStep = z.infer<typeof ChainStepSchema>;
export type ChainToolConfig = z.infer<typeof ChainToolConfigSchema>;
