/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import {randomBytes} from 'node:crypto';
import type {AmodalRepo} from '../repo/repo-types.js';
import type {SurfaceEndpoint} from '../repo/connection-types.js';
import type {
  BuildSnapshotOptions,
  DeploySnapshot,
  SnapshotConnection,
  SnapshotSkill,
  SnapshotAutomation,
  SnapshotKnowledge,
  SnapshotTool,
} from './snapshot-types.js';

/**
 * Generate a deploy ID: `deploy-` followed by 7 hex characters.
 */
export function generateDeployId(): string {
  const hex = randomBytes(4).toString('hex').slice(0, 7);
  return `deploy-${hex}`;
}

/**
 * Serialize surface endpoints back to the markdown format used in surface.md.
 *
 * Format per endpoint:
 * ```
 * - [x] GET /users — List all users
 * - [ ] DELETE /users/:id — Delete a user
 * ```
 */
export function serializeSurface(endpoints: SurfaceEndpoint[]): string {
  if (endpoints.length === 0) return '';

  return endpoints
    .map((ep) => {
      const check = ep.included ? 'x' : ' ';
      const opPrefix = ep.operationType ? `${ep.operationType} ` : '';
      return `- [${check}] ${opPrefix}${ep.method} ${ep.path} — ${ep.description}`;
    })
    .join('\n');
}

/**
 * Build an immutable deploy snapshot from a loaded AmodalRepo.
 *
 * The snapshot contains the fully-resolved configuration with `env:VAR_NAME`
 * references left intact (not resolved) — secrets are resolved at runtime.
 */
export function buildSnapshot(
  repo: AmodalRepo,
  options: BuildSnapshotOptions,
): DeploySnapshot {
  // Transform connections Map to Record
  const connections: Record<string, SnapshotConnection> = {};
  for (const [name, conn] of repo.connections) {
    connections[name] = {
      spec: conn.spec,
      surface: serializeSurface(conn.surface),
      access: conn.access,
      ...(conn.entities ? {entities: conn.entities} : {}),
      ...(conn.rules ? {rules: conn.rules} : {}),
    };
  }

  // Transform skills
  const skills: SnapshotSkill[] = repo.skills.map((s) => ({
    name: s.name,
    description: s.description,
    ...(s.trigger ? {trigger: s.trigger} : {}),
    body: s.body,
  }));

  // Transform automations
  const automations: SnapshotAutomation[] = repo.automations.map((a) => ({
    name: a.name,
    title: a.title,
    ...(a.schedule ? {schedule: a.schedule} : {}),
    trigger: a.trigger,
    prompt: a.prompt,
  }));

  // Transform knowledge
  const knowledge: SnapshotKnowledge[] = repo.knowledge.map((k) => ({
    name: k.name,
    title: k.title,
    body: k.body,
  }));

  // Build agents if present
  const hasAgents = repo.agents.main || repo.agents.simple || (repo.agents.subagents?.length ?? 0) > 0;
  const agents = hasAgents
    ? {
        ...(repo.agents.main ? {main: repo.agents.main} : {}),
        ...(repo.agents.simple ? {simple: repo.agents.simple} : {}),
        ...((repo.agents.subagents?.length ?? 0) > 0
          ? {
              subagents: repo.agents.subagents.map((sa) => ({
                name: sa.name,
                displayName: sa.displayName,
                description: sa.description,
                prompt: sa.prompt,
                tools: sa.tools,
                maxDepth: sa.maxDepth,
                maxToolCalls: sa.maxToolCalls,
                timeout: sa.timeout,
              })),
            }
          : {}),
      }
    : undefined;

  // Transform tools (metadata only — handler code is in Daytona snapshots)
  const tools: SnapshotTool[] = repo.tools.map((t) => ({
    name: t.name,
    description: t.description,
    parameters: t.parameters,
    confirm: t.confirm,
    timeout: t.timeout,
    env: t.env,
  }));

  // Transform evals
  const evals = repo.evals.map((e) => ({
    name: e.name,
    title: e.title,
    description: e.description,
    query: e.query,
    assertions: e.assertions.map((a) => ({text: a.text, negated: a.negated})),
  }));

  return {
    deployId: generateDeployId(),
    createdAt: new Date().toISOString(),
    createdBy: options.createdBy,
    source: options.source,
    ...(options.commitSha ? {commitSha: options.commitSha} : {}),
    ...(options.branch ? {branch: options.branch} : {}),
    ...(options.message ? {message: options.message} : {}),
    config: repo.config,
    connections,
    skills,
    automations,
    knowledge,
    ...(agents ? {agents} : {}),
    ...(tools.length > 0 ? {tools} : {}),
    ...(options.buildManifest ? {buildManifest: options.buildManifest} : {}),
    ...(evals.length > 0 ? {evals} : {}),
    ...((repo.stores?.length ?? 0) > 0 ? {stores: repo.stores.map((s) => ({
      name: s.name,
      entity: s.entity,
      ...(s.ttl !== undefined ? {ttl: s.ttl} : {}),
      ...(s.failure ? {failure: s.failure} : {}),
      ...(s.history ? {history: s.history} : {}),
      ...(s.trace ? {trace: s.trace} : {}),
    }))} : {}),
    ...(repo.mcpServers && Object.keys(repo.mcpServers).length > 0 ? {mcpServers: repo.mcpServers} : {}),
  };
}

/**
 * Serialize a deploy snapshot to a JSON string.
 */
export function serializeSnapshot(snapshot: DeploySnapshot): string {
  return JSON.stringify(snapshot, null, 2);
}

/**
 * Get the byte size of a serialized snapshot.
 */
export function snapshotSizeBytes(serialized: string): number {
  return Buffer.byteLength(serialized, 'utf-8');
}
