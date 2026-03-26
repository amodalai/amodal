/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import {readFile, readdir, stat} from 'node:fs/promises';
import * as path from 'node:path';

import type {AmodalRepo, LoadedAgent, LoadedAutomation, LoadedEval, LoadedKnowledge, LoadedSkill} from './repo-types.js';
import {RepoError} from './repo-types.js';
import type {LoadedConnection} from './connection-types.js';
import {
  parseAgent,
  parseConfig,
  parseConnection,
  parseSkill,
  parseKnowledge,
  parseAutomation,
  parseEval,
} from './parsers.js';
import {readLockFile} from '../packages/lock-file.js';
import {resolveAllPackages} from '../packages/resolver.js';
import {loadStores} from './store-loader.js';
import {loadTools} from './tool-loader.js';

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
 * Load a single connection from its directory.
 */
async function loadConnection(
  connDir: string,
  name: string,
): Promise<LoadedConnection> {
  const specJson = await readRequiredFile(
    path.join(connDir, 'spec.json'),
    `Missing spec.json for connection "${name}"`,
  );
  const accessJson = await readRequiredFile(
    path.join(connDir, 'access.json'),
    `Missing access.json for connection "${name}"`,
  );
  const surfaceMd = await readOptionalFile(path.join(connDir, 'surface.md'));
  const entitiesMd = await readOptionalFile(path.join(connDir, 'entities.md'));
  const rulesMd = await readOptionalFile(path.join(connDir, 'rules.md'));

  return parseConnection(
    name,
    {
      specJson,
      accessJson,
      surfaceMd: surfaceMd ?? undefined,
      entitiesMd: entitiesMd ?? undefined,
      rulesMd: rulesMd ?? undefined,
    },
    connDir,
  );
}

/**
 * Load all connections from the connections/ directory.
 */
async function loadConnections(repoPath: string): Promise<Map<string, LoadedConnection>> {
  const connectionsDir = path.join(repoPath, 'connections');
  const dirs = await listSubdirs(connectionsDir);
  const connections = new Map<string, LoadedConnection>();

  const loaded = await Promise.all(
    dirs.map(async (name) => {
      const conn = await loadConnection(path.join(connectionsDir, name), name);
      return [name, conn] as const;
    }),
  );

  for (const [name, conn] of loaded) {
    connections.set(name, conn);
  }

  return connections;
}

/**
 * Load all skills from the skills/ directory.
 */
async function loadSkills(repoPath: string): Promise<LoadedSkill[]> {
  const skillsDir = path.join(repoPath, 'skills');
  const dirs = await listSubdirs(skillsDir);
  const skills: LoadedSkill[] = [];

  const results = await Promise.all(
    dirs.map(async (name) => {
      const skillPath = path.join(skillsDir, name, 'SKILL.md');
      const content = await readOptionalFile(skillPath);
      if (!content) return null;
      return parseSkill(content, skillPath);
    }),
  );

  for (const result of results) {
    if (result) skills.push(result);
  }

  return skills;
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
 * Load all knowledge files.
 */
async function loadKnowledgeFiles(repoPath: string): Promise<LoadedKnowledge[]> {
  const knowledgeDir = path.join(repoPath, 'knowledge');
  const files = await listMdFiles(knowledgeDir);

  const results = await Promise.all(
    files.map(async (filename) => {
      const filePath = path.join(knowledgeDir, filename);
      const content = await readFile(filePath, 'utf-8');
      const name = filename.replace(/\.md$/, '');
      return parseKnowledge(content, name, filePath);
    }),
  );

  return results;
}

/**
 * Load all automation files.
 */
async function loadAutomations(repoPath: string): Promise<LoadedAutomation[]> {
  const autoDir = path.join(repoPath, 'automations');

  // Support both .json (new) and .md (legacy) automation files
  let files: string[];
  try {
    const entries = await readdir(autoDir, {withFileTypes: true});
    files = entries
      .filter((e) => e.isFile() && (e.name.endsWith('.json') || e.name.endsWith('.md')))
      .map((e) => e.name);
  } catch {
    return [];
  }

  const results = await Promise.all(
    files.map(async (filename) => {
      const filePath = path.join(autoDir, filename);
      const content = await readFile(filePath, 'utf-8');
      const name = filename.replace(/\.(json|md)$/, '');
      return parseAutomation(content, name, filePath);
    }),
  );

  return results;
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
export async function loadRepoFromDisk(repoPath: string): Promise<AmodalRepo> {
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

  // Check for lock file to decide resolution strategy
  let lockFile;
  try {
    lockFile = await readLockFile(absolutePath);
  } catch {
    // Lock file read failed — fall through to direct load
    lockFile = null;
  }

  let connections: Map<string, LoadedConnection>;
  let skills: LoadedSkill[];
  let knowledge: LoadedKnowledge[];
  let automations: LoadedAutomation[];
  let warnings: string[] | undefined;

  if (lockFile && Object.keys(lockFile.packages).length > 0) {
    // Package-aware resolution (merges npm packages + repo overrides)
    const resolved = await resolveAllPackages({repoPath: absolutePath, lockFile});
    connections = resolved.connections;
    skills = resolved.skills;
    knowledge = resolved.knowledge;
    automations = resolved.automations;
    warnings = resolved.warnings.length > 0 ? resolved.warnings : undefined;
  } else {
    // Direct load (no packages installed)
    [connections, skills, knowledge, automations] = await Promise.all([
      loadConnections(absolutePath),
      loadSkills(absolutePath),
      loadKnowledgeFiles(absolutePath),
      loadAutomations(absolutePath),
    ]);
  }

  // Agents, evals, tools, and stores always from disk (not package types)
  const [agents, evals, tools, stores] = await Promise.all([
    loadAgents(absolutePath),
    loadEvals(absolutePath),
    loadTools(absolutePath),
    loadStores(absolutePath),
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
    warnings,
  };
}
