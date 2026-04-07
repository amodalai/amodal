/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import {z} from 'zod';
import {AmodalConfigSchema} from '../repo/config-schema.js';
import {ConnectionSpecSchema, AccessConfigSchema} from '../repo/connection-schemas.js';

/**
 * A serialized connection in a deploy snapshot.
 * Surface is stored as the original markdown string.
 */
export const SnapshotConnectionSchema = z.object({
  spec: ConnectionSpecSchema,
  surface: z.string(),
  access: AccessConfigSchema,
  entities: z.string().optional(),
  rules: z.string().optional(),
});

export type SnapshotConnection = z.infer<typeof SnapshotConnectionSchema>;

/**
 * A serialized skill in a deploy snapshot.
 */
export const SnapshotSkillSchema = z.object({
  name: z.string().min(1),
  description: z.string(),
  trigger: z.string().optional(),
  body: z.string(),
});

export type SnapshotSkill = z.infer<typeof SnapshotSkillSchema>;

/**
 * A serialized automation in a deploy snapshot.
 */
export const SnapshotAutomationSchema = z.object({
  name: z.string().min(1),
  title: z.string(),
  schedule: z.string().optional(),
  trigger: z.enum(['cron', 'webhook', 'manual']).default('manual'),
  prompt: z.string(),
});

export type SnapshotAutomation = z.infer<typeof SnapshotAutomationSchema>;

/**
 * A serialized knowledge document in a deploy snapshot.
 */
export const SnapshotKnowledgeSchema = z.object({
  name: z.string().min(1),
  title: z.string(),
  body: z.string(),
});

export type SnapshotKnowledge = z.infer<typeof SnapshotKnowledgeSchema>;

/**
 * A serialized custom tool in a deploy snapshot.
 * Contains metadata only — handler code lives in Daytona snapshots.
 */
export const SnapshotToolSchema = z.object({
  name: z.string().min(1),
  description: z.string(),
  parameters: z.record(z.unknown()).default({}),
  confirm: z.union([z.literal(false), z.literal(true), z.literal('review'), z.literal('never')]).default(false),
  timeout: z.number().int().positive().default(30000),
  env: z.array(z.string()).default([]),
});

export type SnapshotTool = z.infer<typeof SnapshotToolSchema>;

/**
 * A serialized subagent definition in a deploy snapshot.
 */
export const SnapshotSubagentSchema = z.object({
  name: z.string().min(1),
  displayName: z.string().min(1),
  description: z.string(),
  prompt: z.string(),
  tools: z.array(z.string()).default([]),
  maxDepth: z.number().int().default(1),
  maxToolCalls: z.number().int().default(10),
  timeout: z.number().int().default(20),
});

export type SnapshotSubagent = z.infer<typeof SnapshotSubagentSchema>;

/**
 * Build manifest entry mapping a tool to its Daytona sandbox snapshot.
 */
export const SnapshotToolManifestEntrySchema = z.object({
  snapshotId: z.string().min(1),
  imageHash: z.string().min(1),
  sandboxLanguage: z.string().default('typescript'),
  hasDockerfile: z.boolean().default(false),
  hasSetupScript: z.boolean().default(false),
});

/**
 * Build manifest: maps tool names to Daytona snapshot IDs.
 * Created by `amodal build --tools`, stored in the deploy snapshot.
 */
export const SnapshotBuildManifestSchema = z.object({
  version: z.literal(1),
  builtAt: z.string(),
  tools: z.record(z.string(), SnapshotToolManifestEntrySchema),
});

export type SnapshotBuildManifest = z.infer<typeof SnapshotBuildManifestSchema>;

/**
 * A serialized eval case in a deploy snapshot.
 */
export const SnapshotEvalAssertionSchema = z.object({
  text: z.string(),
  negated: z.boolean().default(false),
});

export const SnapshotEvalSchema = z.object({
  name: z.string().min(1),
  title: z.string(),
  description: z.string().default(''),
  query: z.string(),
  assertions: z.array(SnapshotEvalAssertionSchema),
});

export type SnapshotEval = z.infer<typeof SnapshotEvalSchema>;

/**
 * A serialized channel plugin in a deploy snapshot.
 * Contains the bundled adapter code (ESM) so the hosted runtime can
 * load channels without npm-installing packages at serve time.
 */
export const SnapshotChannelSchema = z.object({
  /** Channel type identifier (e.g. "slack", "telegram"). */
  channelType: z.string().min(1),
  /** Config with env: refs (resolved at runtime). */
  config: z.record(z.unknown()),
});

export type SnapshotChannel = z.infer<typeof SnapshotChannelSchema>;

/**
 * The complete deploy snapshot — an immutable, fully-resolved JSON blob
 * that captures the entire agent configuration at a point in time.
 */
export const DeploySnapshotSchema = z.object({
  deployId: z.string().regex(/^deploy-[0-9a-f]{7}$/),
  createdAt: z.string().datetime(),
  createdBy: z.string(),
  source: z.enum(['cli', 'github', 'admin-ui']),
  commitSha: z.string().optional(),
  branch: z.string().optional(),
  message: z.string().optional(),
  config: AmodalConfigSchema,
  connections: z.record(z.string(), SnapshotConnectionSchema),
  skills: z.array(SnapshotSkillSchema),
  automations: z.array(SnapshotAutomationSchema),
  knowledge: z.array(SnapshotKnowledgeSchema),
  agents: z.object({
    main: z.string().optional(),
    simple: z.string().optional(),
    subagents: z.array(SnapshotSubagentSchema).optional(),
  }).optional(),
  /** Custom tool metadata (handler code lives in Daytona snapshots) */
  tools: z.array(SnapshotToolSchema).optional(),
  /** Store definitions */
  stores: z.array(z.record(z.unknown())).optional(),
  /** Build manifest mapping tool names to Daytona snapshot IDs */
  buildManifest: SnapshotBuildManifestSchema.optional(),
  /** Eval definitions for model evaluation */
  evals: z.array(SnapshotEvalSchema).optional(),
  /** Messaging channel plugins (bundled adapter code + config) */
  channels: z.array(SnapshotChannelSchema).optional(),
  /** MCP servers to connect to */
  mcpServers: z.record(z.string(), z.object({
    transport: z.enum(['stdio', 'sse', 'http']),
    command: z.string().optional(),
    args: z.array(z.string()).optional(),
    env: z.record(z.string()).optional(),
    url: z.string().optional(),
    trust: z.boolean().optional(),
  })).optional(),
});

export type DeploySnapshot = z.infer<typeof DeploySnapshotSchema>;

/**
 * Options for building a snapshot from a loaded repo.
 */
export interface BuildSnapshotOptions {
  createdBy: string;
  source: 'cli' | 'github' | 'admin-ui';
  commitSha?: string;
  branch?: string;
  message?: string;
  /** Build manifest from `amodal build --tools` */
  buildManifest?: SnapshotBuildManifest;
}
