/**
 * @license
 * Copyright 2025 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import {readFile, readdir, stat} from 'node:fs/promises';
import * as path from 'node:path';

import type {LoadedConnection} from '../repo/connection-types.js';
import {parseConnection, parseSkill, parseKnowledge, parseAutomation} from '../repo/parsers.js';
import type {LoadedAutomation, LoadedKnowledge, LoadedSkill} from '../repo/repo-types.js';
import type {LoadedStore} from '../repo/store-types.js';
import {parseStoreJson} from '../repo/store-loader.js';
import type {LoadedTool} from '../repo/tool-types.js';
import {loadTools} from '../repo/tool-loader.js';
import type {AmodalConfig} from '../repo/config-schema.js';

/**
 * The result of resolving all installed packages + local repo content.
 */
export interface ResolvedPackages {
  connections: Map<string, LoadedConnection>;
  skills: LoadedSkill[];
  automations: LoadedAutomation[];
  knowledge: LoadedKnowledge[];
  stores: LoadedStore[];
  tools: LoadedTool[];
  warnings: string[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function readOptionalFile(filePath: string): Promise<string | null> {
  try {
    return await readFile(filePath, 'utf-8');
  } catch (err) {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw err;
  }
}

async function dirExists(dirPath: string): Promise<boolean> {
  try {
    const s = await stat(dirPath);
    return s.isDirectory();
  } catch {
    return false;
  }
}

async function listSubdirs(dirPath: string): Promise<string[]> {
  try {
    const entries = await readdir(dirPath, {withFileTypes: true});
    return entries.filter((e) => e.isDirectory()).map((e) => e.name);
  } catch {
    return [];
  }
}

async function listFiles(dirPath: string, ext?: string): Promise<string[]> {
  try {
    const entries = await readdir(dirPath, {withFileTypes: true});
    return entries
      .filter((e) => e.isFile() && (!ext || e.name.endsWith(ext)))
      .map((e) => e.name);
  } catch {
    return [];
  }
}

/**
 * Resolve the directory for an npm package from node_modules.
 * Handles both scoped (@scope/name) and unscoped packages.
 */
function resolvePackageDir(repoPath: string, npmName: string): string {
  return path.join(repoPath, 'node_modules', ...npmName.split('/'));
}

// ---------------------------------------------------------------------------
// Loading from local repo directories (nested structure)
// ---------------------------------------------------------------------------

async function loadLocalConnections(
  dir: string,
  existing: Map<string, LoadedConnection>,
  warnings: string[],
): Promise<void> {
  const connDir = path.join(dir, 'connections');
  const subdirs = await listSubdirs(connDir);
  for (const name of subdirs) {
    if (existing.has(name)) continue;
    const connPath = path.join(connDir, name);
    const specJson = await readOptionalFile(path.join(connPath, 'spec.json'));
    if (!specJson) {
      warnings.push(`Connection ${name} missing spec.json in ${dir}`);
      continue;
    }

    let isMcp = false;
    try {
      const parsed: unknown = JSON.parse(specJson);
      if (parsed && typeof parsed === 'object' && 'protocol' in parsed) {
         
        isMcp = (parsed as Record<string, unknown>)['protocol'] === 'mcp';
      }
    } catch {
      // Will fail properly in parseConnection
    }

    const accessJson = await readOptionalFile(path.join(connPath, 'access.json'));
    if (!isMcp && !accessJson) {
      warnings.push(`Connection ${name} missing access.json in ${dir}`);
      continue;
    }

    const surfaceMd = await readOptionalFile(path.join(connPath, 'surface.md')) ?? undefined;
    const entitiesMd = await readOptionalFile(path.join(connPath, 'entities.md')) ?? undefined;
    const rulesMd = await readOptionalFile(path.join(connPath, 'rules.md')) ?? undefined;
    try {
      const conn = parseConnection(name, {specJson, accessJson: accessJson ?? '{"endpoints":{}}', surfaceMd, entitiesMd, rulesMd}, connPath);
      existing.set(name, conn);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      warnings.push(`Failed to parse connection ${name}: ${msg}`);
    }
  }
}

async function loadLocalSkills(
  dir: string,
  existingNames: Set<string>,
  skills: LoadedSkill[],
  warnings: string[],
): Promise<void> {
  const skillDir = path.join(dir, 'skills');
  const subdirs = await listSubdirs(skillDir);
  for (const name of subdirs) {
    if (existingNames.has(name)) continue;
    const skillMd = await readOptionalFile(path.join(skillDir, name, 'SKILL.md'));
    if (!skillMd) continue;
    try {
      const skill = parseSkill(skillMd, path.join(skillDir, name));
      if (!skill) continue;
      skills.push(skill);
      existingNames.add(name);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      warnings.push(`Failed to parse skill ${name}: ${msg}`);
    }
  }
}

async function loadLocalAutomations(
  dir: string,
  existingNames: Set<string>,
  automations: LoadedAutomation[],
  warnings: string[],
): Promise<void> {
  const autoDir = path.join(dir, 'automations');
  const files = await listFiles(autoDir);
  for (const file of files) {
    if (!file.endsWith('.json') && !file.endsWith('.md')) continue;
    const name = file.replace(/\.(json|md)$/, '');
    if (existingNames.has(name)) continue;
    const content = await readOptionalFile(path.join(autoDir, file));
    if (!content) continue;
    try {
      const auto = parseAutomation(content, name, path.join(autoDir, file));
      automations.push(auto);
      existingNames.add(name);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      warnings.push(`Failed to parse automation ${name}: ${msg}`);
    }
  }
}

async function loadLocalKnowledge(
  dir: string,
  existingNames: Set<string>,
  knowledge: LoadedKnowledge[],
  warnings: string[],
): Promise<void> {
  const kbDir = path.join(dir, 'knowledge');
  const files = await listFiles(kbDir, '.md');
  for (const file of files) {
    const name = file.replace(/\.md$/, '');
    if (existingNames.has(name)) continue;
    const content = await readOptionalFile(path.join(kbDir, file));
    if (!content) continue;
    try {
      const doc = parseKnowledge(content, name, path.join(kbDir, file));
      knowledge.push(doc);
      existingNames.add(name);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      warnings.push(`Failed to parse knowledge ${name}: ${msg}`);
    }
  }
}

async function loadLocalStores(
  dir: string,
  existingNames: Set<string>,
  stores: LoadedStore[],
  warnings: string[],
): Promise<void> {
  const storeDir = path.join(dir, 'stores');
  const files = await listFiles(storeDir, '.json');
  for (const file of files) {
    const name = file.replace(/\.json$/, '');
    if (existingNames.has(name)) continue;
    const content = await readOptionalFile(path.join(storeDir, file));
    if (!content) continue;
    try {
      const store = parseStoreJson(content, name, path.join(storeDir, file));
      stores.push(store);
      existingNames.add(name);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      warnings.push(`Failed to parse store ${name}: ${msg}`);
    }
  }
}

async function loadLocalTools(
  dir: string,
  existingNames: Set<string>,
  tools: LoadedTool[],
  warnings: string[],
): Promise<void> {
  try {
    const loaded = await loadTools(dir);
    for (const tool of loaded) {
      if (existingNames.has(tool.name)) continue;
      tools.push(tool);
      existingNames.add(tool.name);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    warnings.push(`Failed to load tools from ${dir}: ${msg}`);
  }
}

// ---------------------------------------------------------------------------
// Full resolution
// ---------------------------------------------------------------------------

/**
 * Resolve all content: local repo directories + declared npm packages.
 * Local repo files always win over package files for the same name.
 *
 * Packages are declared in amodal.json `packages` array. Each package
 * is scanned for standard content directories (connections/, skills/, etc.)
 * using the same loaders as local repo content.
 */
export async function resolveAllPackages(options: {
  repoPath: string;
  config?: AmodalConfig;
}): Promise<ResolvedPackages> {
  const {repoPath, config} = options;
  const warnings: string[] = [];

  const connections = new Map<string, LoadedConnection>();
  const skills: LoadedSkill[] = [];
  const automations: LoadedAutomation[] = [];
  const knowledge: LoadedKnowledge[] = [];
  const stores: LoadedStore[] = [];
  const tools: LoadedTool[] = [];

  // Track names to prevent duplicates (local wins over packages)
  const skillNames = new Set<string>();
  const automationNames = new Set<string>();
  const knowledgeNames = new Set<string>();
  const storeNames = new Set<string>();
  const toolNames = new Set<string>();

  // 1. Load from local repo first (local always wins)
  await loadLocalConnections(repoPath, connections, warnings);
  await loadLocalSkills(repoPath, skillNames, skills, warnings);
  await loadLocalAutomations(repoPath, automationNames, automations, warnings);
  await loadLocalKnowledge(repoPath, knowledgeNames, knowledge, warnings);
  await loadLocalStores(repoPath, storeNames, stores, warnings);
  await loadLocalTools(repoPath, toolNames, tools, warnings);

  // 2. Load from declared npm packages (same nested structure as local repo)
  const packageNames = config?.packages;
  if (packageNames && packageNames.length > 0) {
    for (const npmName of packageNames) {
      const pkgDir = resolvePackageDir(repoPath, npmName);
      if (!(await dirExists(pkgDir))) {
        warnings.push(`Package "${npmName}" declared in amodal.json but not installed. Run: npm install`);
        continue;
      }
      // Scan package for all content types — same loaders as local repo
      await loadLocalConnections(pkgDir, connections, warnings);
      await loadLocalSkills(pkgDir, skillNames, skills, warnings);
      await loadLocalAutomations(pkgDir, automationNames, automations, warnings);
      await loadLocalKnowledge(pkgDir, knowledgeNames, knowledge, warnings);
      await loadLocalStores(pkgDir, storeNames, stores, warnings);
      await loadLocalTools(pkgDir, toolNames, tools, warnings);
    }
  }

  return {connections, skills, automations, knowledge, stores, tools, warnings};
}
