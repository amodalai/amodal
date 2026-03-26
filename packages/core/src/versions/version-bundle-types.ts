/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import { z } from 'zod';
import { HttpToolConfigSchema } from '../tools/http-tool-types.js';
import { ChainToolConfigSchema } from '../tools/chain-tool-types.js';
import { FunctionToolConfigSchema } from '../tools/function-tool-types.js';
import { RoleDefinitionSchema } from '../roles/role-types.js';

// ---------------------------------------------------------------------------
// Automation schemas
// ---------------------------------------------------------------------------

/**
 * Automation trigger — cron schedule or webhook event.
 */
export const AutomationTriggerSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('cron'),
    // Cron expression (e.g., "*/5 * * * *")
    schedule: z.string().min(1),
  }),
  z.object({
    type: z.literal('webhook'),
    /** Event source identifier */
    source: z.string().min(1),
    /** Optional filter expression for the webhook payload */
    filter: z.string().optional(),
  }),
]);

/**
 * Automation output channel configuration.
 */
export const AutomationOutputSchema = z.object({
  /** Output channel type */
  channel: z.enum(['slack', 'webhook', 'email']),
  /** Channel-specific target (URL, email address, etc.) */
  target: z.string().min(1),
});

/**
 * Constraints applied to automation sessions.
 */
export const AutomationConstraintsSchema = z.object({
  /** Maximum number of tool calls per automation run */
  max_tool_calls: z.number().int().positive().optional(),
  /** Timeout in seconds for the entire automation run */
  timeout_seconds: z.number().int().positive().optional(),
  /** Maximum tokens for the LLM response */
  max_tokens: z.number().int().positive().optional(),
});

/**
 * An automation definition — scheduled or event-triggered agent prompt.
 */
export const AutomationDefinitionSchema = z.object({
  /** Unique automation name */
  name: z.string().min(1),
  /** How this automation is triggered */
  trigger: AutomationTriggerSchema,
  /** The prompt sent to the agent when triggered */
  prompt: z.string().min(1),
  /** Tools available during this automation's session */
  tools: z.array(z.string().min(1)).min(1),
  /** Skills available during this automation's session */
  skills: z.array(z.string().min(1)).default(['*']),
  /** Where to send the automation's output */
  output: AutomationOutputSchema,
  /** Session constraints */
  constraints: AutomationConstraintsSchema.optional(),
  /** Whether write operations are allowed (default false — safety guardrail) */
  allow_writes: z.boolean().default(false),
  /** Session types where this automation is available. Empty/undefined = all. */
  session_types: z.array(z.string().min(1)).optional(),
});

// ---------------------------------------------------------------------------
// Bundle tool config — discriminated union of all tool types
// ---------------------------------------------------------------------------

const BundleHttpToolSchema = HttpToolConfigSchema.extend({
  type: z.literal('http'),
  disabled: z.boolean().optional(),
  session_types: z.array(z.string().min(1)).optional(),
});

const BundleChainToolSchema = ChainToolConfigSchema.extend({
  type: z.literal('chain'),
  disabled: z.boolean().optional(),
  session_types: z.array(z.string().min(1)).optional(),
});

const BundleFunctionToolSchema = FunctionToolConfigSchema.extend({
  type: z.literal('function'),
  disabled: z.boolean().optional(),
  session_types: z.array(z.string().min(1)).optional(),
});

/**
 * A tool config in a version bundle — discriminated by `type`.
 */
export const BundleToolConfigSchema = z.discriminatedUnion('type', [
  BundleHttpToolSchema,
  BundleChainToolSchema,
  BundleFunctionToolSchema,
]);

// ---------------------------------------------------------------------------
// Handler and dependency schemas
// ---------------------------------------------------------------------------

/**
 * A handler definition — entry file plus all source files.
 */
export const BundleHandlerSchema = z.object({
  /** Entry point filename (e.g., "compute-risk.ts") */
  entry: z.string().min(1),
  /** Map of filename → source code */
  files: z.record(z.string().min(1)),
});

/**
 * Dependencies required by the version bundle.
 */
export const BundleDependenciesSchema = z.object({
  /** npm packages: { name: version } */
  npm: z.record(z.string()).optional(),
  /** pip packages: { name: version } */
  pip: z.record(z.string()).optional(),
  /** System binaries that must be available (checked via `which`) */
  system: z.array(z.string().min(1)).optional(),
});

// ---------------------------------------------------------------------------
// Skill schema
// ---------------------------------------------------------------------------

/**
 * Knowledge base dependencies for a skill — tags and scope to auto-load.
 */
export const SkillKnowledgeDepsSchema = z.object({
  /** Docs matching any of these tags are auto-loaded on skill activation. */
  tags: z.array(z.string().min(1)).optional(),
  /** Restrict to a specific scope, or 'all' for both application and tenant. Default: 'all'. */
  scope: z.enum(['application', 'tenant', 'all']).optional(),
});

/**
 * A skill definition in a version bundle.
 */
export const BundleSkillSchema = z.object({
  /** Skill name (used for activation) */
  name: z.string().min(1),
  /** Short description (shown to LLM in system prompt) */
  description: z.string().min(1),
  /** Full skill body (SKILL.md content, loaded on activation) */
  body: z.string().min(1),
  /** Knowledge base documents to auto-load when this skill activates. */
  knowledge: SkillKnowledgeDepsSchema.optional(),
  /** Session types where this skill is available. Empty/undefined = all. */
  session_types: z.array(z.string().min(1)).optional(),
});

// ---------------------------------------------------------------------------
// Subagent schema
// ---------------------------------------------------------------------------

/**
 * A subagent (task agent) configuration in a version bundle.
 */
export const SubagentConfigSchema = z.object({
  /** Subagent name (used for dispatch) */
  name: z.string().min(1),
  /** Display name shown in the admin UI */
  displayName: z.string().min(1),
  /** Short description (visible to admins and injected into primary agent context) */
  description: z.string().min(1),
  /** Prompt template with {{variable}} placeholders */
  prompt: z.string().min(1),
  /** Tools this subagent can use */
  tools: z.array(z.string().min(1)).default(['shell_exec', 'load_knowledge']),
  /** Max dispatch depth (1 = no sub-agents, 2 = can dispatch sub-task agents) */
  maxDepth: z.number().int().min(1).max(4).default(1),
  /** Max tool calls per execution */
  maxToolCalls: z.number().int().min(1).max(100).default(10),
  /** Timeout in seconds */
  timeout: z.number().int().min(5).max(600).default(20),
  /** Target output token range */
  targetOutputMin: z.number().int().min(50).max(2000).default(200),
  targetOutputMax: z.number().int().min(50).max(2000).default(400),
  /** Model tier: 'simple' for data gathering, 'advanced' for complex reasoning, 'default' for standard */
  modelTier: z.enum(['default', 'simple', 'advanced']).optional(),
  /** Session types where this subagent is available. Empty/undefined = all. */
  session_types: z.array(z.string().min(1)).optional(),
});

// ---------------------------------------------------------------------------
// Full version bundle
// ---------------------------------------------------------------------------

/**
 * A complete version bundle — the atomic unit of deployment.
 */
export const VersionBundleSchema = z.object({
  /** Semantic version string (e.g., "1.2.3") */
  version: z.string().min(1),
  /** ISO 8601 timestamp when published */
  published_at: z.string().optional(),
  /** Who published this version */
  published_by: z.string().optional(),
  /** Tool configurations */
  tools: z.array(BundleToolConfigSchema).default([]),
  /** Skill definitions */
  skills: z.array(BundleSkillSchema).default([]),
  /** Handler definitions keyed by handler name */
  handlers: z.record(BundleHandlerSchema).default({}),
  /** External dependencies */
  dependencies: BundleDependenciesSchema.default({}),
  /** Role definitions */
  roles: z.array(RoleDefinitionSchema).default([]),
  /** Automation definitions */
  automations: z.array(AutomationDefinitionSchema).default([]),
});

// ---------------------------------------------------------------------------
// Inferred types
// ---------------------------------------------------------------------------

export type AutomationTrigger = z.infer<typeof AutomationTriggerSchema>;
export type AutomationOutput = z.infer<typeof AutomationOutputSchema>;
export type AutomationConstraints = z.infer<typeof AutomationConstraintsSchema>;
export type AutomationDefinition = z.infer<typeof AutomationDefinitionSchema>;

export type BundleToolConfig = z.infer<typeof BundleToolConfigSchema>;
export type BundleHandler = z.infer<typeof BundleHandlerSchema>;
export type BundleDependencies = z.infer<typeof BundleDependenciesSchema>;
export type BundleSkill = z.infer<typeof BundleSkillSchema>;
export type SubagentConfig = z.infer<typeof SubagentConfigSchema>;
export type VersionBundle = z.infer<typeof VersionBundleSchema>;
