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

import {getNpmContextPaths} from './npm-context.js';
import type {LockFile} from './package-types.js';
// isAmodalPackage available for future use

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

// --- Helpers ---

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

// --- Loading from a single package directory ---

async function loadConnectionsFromDir(
  dir: string,
  existing: Map<string, LoadedConnection>,
  warnings: string[],
): Promise<void> {
  const connDir = path.join(dir, 'connections');
  const subdirs = await listSubdirs(connDir);
  for (const name of subdirs) {
    if (existing.has(name)) continue; // Local wins
    const connPath = path.join(connDir, name);
    const specJson = await readOptionalFile(path.join(connPath, 'spec.json'));
    const accessJson = await readOptionalFile(path.join(connPath, 'access.json'));
    if (!specJson || !accessJson) {
      warnings.push(`Connection ${name} missing spec.json or access.json in ${dir}`);
      continue;
    }
    const surfaceMd = await readOptionalFile(path.join(connPath, 'surface.md')) ?? undefined;
    const entitiesMd = await readOptionalFile(path.join(connPath, 'entities.md')) ?? undefined;
    const rulesMd = await readOptionalFile(path.join(connPath, 'rules.md')) ?? undefined;
    try {
      const conn = parseConnection(name, {specJson, accessJson, surfaceMd, entitiesMd, rulesMd}, connPath);
      existing.set(name, conn);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      warnings.push(`Failed to parse connection ${name}: ${msg}`);
    }
  }
}

async function loadSkillsFromDir(
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

async function loadAutomationsFromDir(
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

async function loadKnowledgeFromDir(
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

async function loadStoresFromDir(
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

async function loadToolsFromDir(
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

// --- Full resolution ---

/**
 * Resolve all packages: scan installed packages in node_modules, then local repo.
 * Local repo files always win over package files for the same name.
 */
export async function resolveAllPackages(options: {
  repoPath: string;
  lockFile: LockFile | null;
}): Promise<ResolvedPackages> {
  const {repoPath, lockFile} = options;
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
  await loadConnectionsFromDir(repoPath, connections, warnings);
  await loadSkillsFromDir(repoPath, skillNames, skills, warnings);
  await loadAutomationsFromDir(repoPath, automationNames, automations, warnings);
  await loadKnowledgeFromDir(repoPath, knowledgeNames, knowledge, warnings);
  await loadStoresFromDir(repoPath, storeNames, stores, warnings);
  await loadToolsFromDir(repoPath, toolNames, tools, warnings);

  // 2. Load from installed packages (additive, local wins on conflicts)
  if (lockFile && Object.keys(lockFile.packages).length > 0) {
    const paths = getNpmContextPaths(repoPath);
    const scopeDir = path.join(paths.nodeModules, '@amodalai');

    if (await dirExists(scopeDir)) {
      let packageDirs: string[];
      try {
        packageDirs = await listSubdirs(scopeDir);
      } catch {
        packageDirs = [];
      }

      for (const pkgDirName of packageDirs) {
        const npmName = `@amodalai/${pkgDirName}`;
        // Only load packages that are in the lock file
        if (!lockFile.packages[npmName]) continue;

        const pkgDir = path.join(scopeDir, pkgDirName);
        await loadConnectionsFromDir(pkgDir, connections, warnings);
        await loadSkillsFromDir(pkgDir, skillNames, skills, warnings);
        await loadAutomationsFromDir(pkgDir, automationNames, automations, warnings);
        await loadKnowledgeFromDir(pkgDir, knowledgeNames, knowledge, warnings);
        await loadStoresFromDir(pkgDir, storeNames, stores, warnings);
        await loadToolsFromDir(pkgDir, toolNames, tools, warnings);
      }
    }
  }

  return {connections, skills, automations, knowledge, stores, tools, warnings};
}
