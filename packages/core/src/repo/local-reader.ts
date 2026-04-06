/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import {readFile, readdir, stat} from 'node:fs/promises';
import * as path from 'node:path';

import type {AgentBundle, LoadedAgent, LoadedEval} from './repo-types.js';
import {RepoError} from './repo-types.js';
import {
  parseAgent,
  parseConfig,
  parseEval,
} from './parsers.js';
 
import {resolveAllPackages} from '../packages/resolver.js';

/**
 * Read a file from disk, returning null if it doesn't exist.
 */
async function readOptionalFile(filePath: string): Promise<string | null> {
  try {
    return await readFile(filePath, 'utf-8');
  } catch (err) {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return null;
    }
    throw new RepoError('READ_FAILED', `Failed to read ${filePath}`, err);
  }
}

/**
 * Read a required file from disk.
 */
async function readRequiredFile(filePath: string, errorMsg: string): Promise<string> {
  try {
    return await readFile(filePath, 'utf-8');
  } catch (err) {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new RepoError('CONFIG_NOT_FOUND', errorMsg, err);
    }
    throw new RepoError('READ_FAILED', `Failed to read ${filePath}`, err);
  }
}

/**
 * List subdirectories in a directory. Returns [] if dir doesn't exist.
 */
async function listSubdirs(dirPath: string): Promise<string[]> {
  try {
    const entries = await readdir(dirPath, {withFileTypes: true});
    return entries
      .filter((e) => e.isDirectory())
      .map((e) => e.name);
  } catch {
    return [];
  }
}

/**
 * List .md files in a directory. Returns [] if dir doesn't exist.
 */
async function listMdFiles(dirPath: string): Promise<string[]> {
  try {
    const entries = await readdir(dirPath, {withFileTypes: true});
    return entries
      .filter((e) => e.isFile() && e.name.endsWith('.md'))
      .map((e) => e.name);
  } catch {
    return [];
  }
}

/**
 * Load agents from the agents/ directory.
 *
 * - agents/main/AGENT.md → overrides the primary agent prompt
 * - agents/explore/AGENT.md → overrides the explore sub-agent prompt
 * - agents/plan/AGENT.md → overrides the plan agent prompt
 * - agents/<anything-else>/AGENT.md → defines a custom subagent
 *
 * Flat files agents/main.md and agents/simple.md are also supported.
 */
async function loadAgents(
  repoPath: string,
): Promise<{main?: string; simple?: string; subagents: LoadedAgent[]}> {
  const agentsDir = path.join(repoPath, 'agents');
  const dirs = await listSubdirs(agentsDir);

  // Check for flat files (main.md, simple.md)
  const [mainFlat, simpleFlat] = await Promise.all([
    readOptionalFile(path.join(agentsDir, 'main.md')),
    readOptionalFile(path.join(agentsDir, 'simple.md')),
  ]);

  let main: string | undefined = mainFlat ?? undefined;
  let simple: string | undefined = simpleFlat ?? undefined;
  const subagents: LoadedAgent[] = [];

  // Process subdirectories
  const results = await Promise.all(
    dirs.map(async (name) => {
      const agentPath = path.join(agentsDir, name, 'AGENT.md');
      const content = await readOptionalFile(agentPath);
      if (!content) return null;
      return {name, content, location: agentPath};
    }),
  );

  for (const result of results) {
    if (!result) continue;

    if (result.name === 'main') {
      main = result.content;
    } else if (result.name === 'simple') {
      simple = result.content;
    } else if (result.name === 'plan') {
      const parsed = parseAgent(result.content, result.name, result.location);
      if (parsed) subagents.push(parsed);
    } else {
      const parsed = parseAgent(result.content, result.name, result.location);
      if (parsed) subagents.push(parsed);
    }
  }

  return {main, simple, subagents};
}

/**
 * Load all eval files.
 */
async function loadEvals(repoPath: string): Promise<LoadedEval[]> {
  const evalsDir = path.join(repoPath, 'evals');
  const files = await listMdFiles(evalsDir);

  const results = await Promise.all(
    files.map(async (filename) => {
      const filePath = path.join(evalsDir, filename);
      const content = await readFile(filePath, 'utf-8');
      const name = filename.replace(/\.md$/, '');
      return parseEval(content, name, filePath);
    }),
  );

  return results;
}

/**
 * Load the full amodal repo from disk.
 */
export async function loadRepoFromDisk(repoPath: string): Promise<AgentBundle> {
  const absolutePath = path.resolve(repoPath);

  // Verify the path exists
  try {
    await stat(absolutePath);
  } catch {
    throw new RepoError('CONFIG_NOT_FOUND', `Repo path does not exist: ${absolutePath}`);
  }

  // Read config (required)
  const configPath = path.join(absolutePath, 'amodal.json');
  const configJson = await readRequiredFile(
    configPath,
    `Missing amodal.json in ${absolutePath}`,
  );
  const config = parseConfig(configJson);

  // Resolve all packages: local repo + installed packages (local wins)
  const resolved = await resolveAllPackages({repoPath: absolutePath, config});
  const connections = resolved.connections;
  const skills = resolved.skills;
  const knowledge = resolved.knowledge;
  const automations = resolved.automations;
  const stores = resolved.stores;
  const tools = resolved.tools;
  const warnings = resolved.warnings.length > 0 ? resolved.warnings : undefined;

  // Agents and evals always from local repo only (not installable)
  const [agents, evals] = await Promise.all([
    loadAgents(absolutePath),
    loadEvals(absolutePath),
  ]);

  return {
    source: 'local',
    origin: absolutePath,
    config,
    connections,
    skills,
    agents,
    knowledge,
    automations,
    evals,
    tools,
    stores,
    mcpServers: config.mcp?.servers,
    channels: resolved.channels && resolved.channels.length > 0 ? resolved.channels : undefined,
    warnings,
  };
}
