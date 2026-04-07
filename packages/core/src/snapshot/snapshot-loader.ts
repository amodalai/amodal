/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import {readFile} from 'node:fs/promises';
import {ZodError} from 'zod';
import type {AgentBundle} from '../repo/repo-types.js';
import type {LoadedConnection, SurfaceEndpoint} from '../repo/connection-types.js';
import {DeploySnapshotSchema} from './snapshot-types.js';
import type {DeploySnapshot} from './snapshot-types.js';

/**
 * Parse surface markdown back into SurfaceEndpoint[].
 *
 * Expected format per line:
 * ```
 * - [x] GET /users — List all users
 * - [ ] DELETE /users/:id — Delete a user
 * - [x] query GET /graphql — Query endpoint
 * ```
 */
export function parseSurfaceFromSnapshot(surfaceMarkdown: string): SurfaceEndpoint[] {
  if (!surfaceMarkdown.trim()) return [];

  const endpoints: SurfaceEndpoint[] = [];
  const lines = surfaceMarkdown.split('\n');

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('- [')) continue;

    // Match: - [x] or - [ ]
    const included = trimmed.startsWith('- [x]');
    const rest = trimmed.slice(6).trim(); // After "- [x] " or "- [ ] "

    // Check for operationType prefix (query, mutation, subscription)
    let operationType: 'query' | 'mutation' | 'subscription' | undefined;
    let methodAndPath = rest;
    for (const op of ['query', 'mutation', 'subscription'] as const) {
      if (rest.startsWith(`${op} `)) {
        operationType = op;
        methodAndPath = rest.slice(op.length + 1);
        break;
      }
    }

    // Split on " — " for description
    const dashIdx = methodAndPath.indexOf(' — ');
    if (dashIdx === -1) continue;

    const methodPath = methodAndPath.slice(0, dashIdx).trim();
    const description = methodAndPath.slice(dashIdx + 3).trim();

    // Split method and path
    const spaceIdx = methodPath.indexOf(' ');
    if (spaceIdx === -1) continue;

    const method = methodPath.slice(0, spaceIdx);
    const path = methodPath.slice(spaceIdx + 1);

    endpoints.push({
      method,
      path,
      description,
      included,
      ...(operationType ? {operationType} : {}),
    });
  }

  return endpoints;
}

/**
 * Load a deploy snapshot from a JSON file on disk.
 * Validates with Zod schema.
 */
export async function loadSnapshotFromFile(filePath: string): Promise<DeploySnapshot> {
  let content: string;
  try {
    content = await readFile(filePath, 'utf-8');
  } catch (err) {
    throw new Error(`Failed to read snapshot file: ${filePath}`, {cause: err});
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch (err) {
    throw new Error(`Invalid JSON in snapshot file: ${filePath}`, {cause: err});
  }

  try {
    return DeploySnapshotSchema.parse(parsed);
  } catch (err) {
    if (err instanceof ZodError) {
      const issues = err.issues
        .map((i) => `${i.path.join('.')}: ${i.message}`)
        .join('; ');
      throw new Error(`Snapshot validation failed: ${issues}`, { cause: err });
    }
    throw err;
  }
}

/**
 * Convert a deploy snapshot back into an AgentBundle for runtime use
 * (e.g., `amodal serve --config ./resolved-config.json`).
 */
export function snapshotToBundle(snapshot: DeploySnapshot, origin: string): AgentBundle {
  const connections = new Map<string, LoadedConnection>();
  for (const [name, conn] of Object.entries(snapshot.connections)) {
    connections.set(name, {
      name,
      spec: conn.spec,
      access: conn.access,
      surface: parseSurfaceFromSnapshot(conn.surface),
      entities: conn.entities,
      rules: conn.rules,
      location: `snapshot:${snapshot.deployId}`,
    });
  }

  return {
    source: 'platform',
    origin,
    config: snapshot.config,
    connections,
    skills: snapshot.skills.map((s) => ({
      name: s.name,
      description: s.description,
      trigger: s.trigger,
      body: s.body,
      location: `snapshot:${snapshot.deployId}`,
    })),
    agents: {
      main: snapshot.agents?.main,
      simple: snapshot.agents?.simple,
      subagents: (snapshot.agents?.subagents ?? []).map((sa) => ({
        name: sa.name,
        displayName: sa.displayName,
        description: sa.description,
        prompt: sa.prompt,
        tools: sa.tools ?? [],
        maxDepth: sa.maxDepth ?? 1,
        maxToolCalls: sa.maxToolCalls ?? 10,
        timeout: sa.timeout ?? 20,
        targetOutputMin: 200,
        targetOutputMax: 400,
        location: `snapshot:${snapshot.deployId}`,
      })),
    },
    automations: snapshot.automations.map((a) => ({
      name: a.name,
      title: a.title,
      schedule: a.schedule,
      trigger: a.trigger,
      prompt: a.prompt,
      location: `snapshot:${snapshot.deployId}`,
    })),
    knowledge: snapshot.knowledge.map((k) => ({
      name: k.name,
      title: k.title,
      body: k.body,
      location: `snapshot:${snapshot.deployId}`,
    })),
    evals: (snapshot.evals ?? []).map((e) => ({
      name: e.name,
      title: e.title,
      description: e.description,
      setup: {},
      query: e.query,
      assertions: e.assertions.map((a) => ({text: a.text, negated: a.negated})),
      raw: '',
      location: `snapshot:${snapshot.deployId}`,
    })),
    tools: (snapshot.tools ?? []).map((t) => ({
      name: t.name,
      description: t.description,
      parameters: t.parameters,
      confirm: t.confirm,
      timeout: t.timeout,
      env: t.env,
      handlerPath: '', // Handler code is in Daytona snapshots, not on disk
      location: `snapshot:${snapshot.deployId}`,
      hasPackageJson: false,
      hasSetupScript: false,
      hasRequirementsTxt: false,
      hasDockerfile: false,
      sandboxLanguage: 'typescript',
    })),
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- snapshot store to LoadedStore
    stores: (snapshot.stores ?? []).map((s) => ({
      ...s,
      location: `snapshot:${snapshot.deployId}`,
    })) as Array<import('../repo/store-types.js').LoadedStore>,
    mcpServers: snapshot.mcpServers,
    ...((snapshot.channels?.length ?? 0) > 0 ? {channels: snapshot.channels!.map((ch) => ({
      channelType: ch.channelType,
      packageName: `snapshot:${snapshot.deployId}`,
      packageDir: '',
      config: ch.config,
    }))} : {}),
  };
}
