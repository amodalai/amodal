/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import type {AmodalConfig} from './config-types.js';
import type {AccessConfig, ConnectionSpec} from './connection-types.js';

/**
 * A serialized connection in a deploy snapshot.
 */
export interface SnapshotConnection {
  spec: ConnectionSpec;
  surface: string;
  access: AccessConfig;
  entities?: string;
  rules?: string;
}

/**
 * A serialized skill in a deploy snapshot.
 */
export interface SnapshotSkill {
  name: string;
  description: string;
  trigger?: string;
  body: string;
}

/**
 * A serialized automation in a deploy snapshot.
 */
export interface SnapshotAutomation {
  name: string;
  title: string;
  schedule?: string;
  trigger: 'cron' | 'webhook' | 'manual';
  prompt: string;
}

/**
 * A serialized knowledge document in a deploy snapshot.
 */
export interface SnapshotKnowledge {
  name: string;
  title: string;
  body: string;
}

/**
 * A serialized custom tool in a deploy snapshot.
 */
export interface SnapshotTool {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  confirm: false | true | 'review' | 'never';
  timeout: number;
  env: string[];
}

/**
 * A serialized subagent definition in a deploy snapshot.
 */
export interface SnapshotSubagent {
  name: string;
  displayName: string;
  description: string;
  prompt: string;
  tools: string[];
  maxDepth: number;
  maxToolCalls: number;
  timeout: number;
}

/**
 * Build manifest entry mapping a tool to its sandbox snapshot.
 */
export interface SnapshotToolManifestEntry {
  snapshotId: string;
  imageHash: string;
  sandboxLanguage: string;
  hasDockerfile: boolean;
  hasSetupScript: boolean;
}

/**
 * Build manifest: maps tool names to sandbox snapshot IDs.
 */
export interface SnapshotBuildManifest {
  version: 1;
  builtAt: string;
  tools: Record<string, SnapshotToolManifestEntry>;
}

/**
 * A serialized eval case in a deploy snapshot.
 */
export interface SnapshotEval {
  name: string;
  title: string;
  description: string;
  query: string;
  assertions: Array<{text: string; negated: boolean}>;
}

/**
 * The complete deploy snapshot — an immutable, fully-resolved JSON blob
 * that captures the entire agent configuration at a point in time.
 */
export interface DeploySnapshot {
  deployId: string;
  createdAt: string;
  createdBy: string;
  source: 'cli' | 'github' | 'admin-ui';
  commitSha?: string;
  branch?: string;
  message?: string;
  config: AmodalConfig;
  connections: Record<string, SnapshotConnection>;
  skills: SnapshotSkill[];
  automations: SnapshotAutomation[];
  knowledge: SnapshotKnowledge[];
  agents?: {
    main?: string;
    simple?: string;
    subagents?: SnapshotSubagent[];
  };
  tools?: SnapshotTool[];
  stores?: Array<Record<string, unknown>>;
  buildManifest?: SnapshotBuildManifest;
  evals?: SnapshotEval[];
  mcpServers?: Record<string, {
    transport: 'stdio' | 'sse' | 'http';
    command?: string;
    args?: string[];
    env?: Record<string, string>;
    url?: string;
    trust?: boolean;
  }>;
}

/**
 * Options for building a snapshot from a loaded repo.
 */
export interface BuildSnapshotOptions {
  createdBy: string;
  source: 'cli' | 'github' | 'admin-ui';
  commitSha?: string;
  branch?: string;
  message?: string;
  buildManifest?: SnapshotBuildManifest;
}
