/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import {z} from 'zod';
import {ResponseShapingSchema} from '../tools/http-tool-types.js';

// Re-export pure types from the shared types package.
export type {
  LoadedTool,
  CustomToolContext,
  ToolHandlerDefinition,
  CustomToolExecutor,
  CustomShellExecutor,
} from '@amodalai/types';
export {defineToolHandler} from '@amodalai/types';

/** Regex for valid tool names — snake_case, starts with lowercase letter */
export const TOOL_NAME_REGEX = /^[a-z][a-z0-9_]*$/;

/**
 * Schema for a tool.json file in the tools/ directory.
 */
export const ToolJsonSchema = z.object({
  name: z.string().regex(TOOL_NAME_REGEX, 'Tool name must be snake_case (lowercase letters, digits, underscores)').optional(),
  description: z.string().min(1),
  parameters: z.record(z.unknown()).default({}),
  confirm: z.union([z.literal(false), z.literal(true), z.literal('review'), z.literal('never')]).default(false),
  timeout: z.number().int().positive().default(30000),
  env: z.array(z.string()).default([]),
  responseShaping: ResponseShapingSchema.optional(),
  sandbox: z.object({
    language: z.string().default('typescript'),
  }).optional(),
});

export type ToolJson = z.infer<typeof ToolJsonSchema>;
