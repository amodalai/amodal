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
  /**
   * Short user-facing phrase rendered by the chat ToolCallCard while
   * the tool is running. Present-participle tense reads naturally:
   * "Looking up template 'marketing-digest'", "Saving progress",
   * "Reading skills/marketing.md". Supports `{{paramName}}`
   * substitution against the call's parameters; missing/non-string
   * params drop out cleanly. Optional — tools without a label fall
   * back to their `name` in the UI.
   */
  runningLabel: z.string().optional(),
  /**
   * Past-tense version shown after the tool completes successfully:
   * "Looked up template", "Saved progress", "Read skills/marketing.md".
   * Same `{{paramName}}` substitution. Optional — when omitted the
   * UI keeps showing `runningLabel` after completion (the status icon
   * differentiates done vs in-flight either way).
   */
  completedLabel: z.string().optional(),
  /**
   * Mark the tool as internal plumbing the user shouldn't see by default
   * (e.g. setup-state I/O, version checks, internal coordination). The
   * runtime stamps the flag onto `tool_call_start` / `tool_call_result`
   * SSE events; the chat widget hides these calls unless `verboseTools`
   * is enabled. Defaults to false — anything that does *work* (installs,
   * external API calls, OAuth, file modifications) should leave this
   * unset so users can see it.
   */
  internal: z.boolean().optional(),
  confirm: z.union([z.literal(false), z.literal(true), z.literal('review'), z.literal('never')]).default(false),
  timeout: z.number().int().positive().default(30000),
  env: z.array(z.string()).default([]),
  responseShaping: ResponseShapingSchema.optional(),
  sandbox: z.object({
    language: z.string().default('typescript'),
  }).optional(),
});

export type ToolJson = z.infer<typeof ToolJsonSchema>;
