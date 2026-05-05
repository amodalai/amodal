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
import {buildSubthingFilter, normalizePackageEntry} from '../repo/config-schema.js';
import {mergeAccessJson, mergeSurface} from './merge-engine.js';

/**
 * The result of resolving all installed packages + local repo content.
 */
/** A discovered channel plugin from a package. */
export interface ResolvedChannel {
  /** Channel type identifier. */
  channelType: string;
  /** npm package name. */
  packageName: string;
  /** Absolute path to the package directory in node_modules. */
  packageDir: string;
  /** Config from channel.json with env: refs (not yet resolved). */
  config: Record<string, unknown>;
}

export interface ResolvedPackages {
  connections: Map<string, LoadedConnection>;
  skills: LoadedSkill[];
  automations: LoadedAutomation[];
  knowledge: LoadedKnowledge[];
  stores: LoadedStore[];
  tools: LoadedTool[];
  channels: ResolvedChannel[];
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
async function resolvePackageDir(repoPath: string, npmName: string): Promise<string | null> {
  const segments = npmName.split('/');
  const candidates = [
    path.join(repoPath, 'node_modules', ...segments),
    path.join(repoPath, 'amodal_packages', '.npm', 'node_modules', ...segments),
  ];
  for (const candidate of candidates) {
    if (await dirExists(candidate)) return candidate;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Loading from local repo directories (nested structure)
// ---------------------------------------------------------------------------

async function loadLocalConnections(
  dir: string,
  existing: Map<string, LoadedConnection>,
  warnings: string[],
  accept?: (name: string) => boolean,
): Promise<void> {
  const connDir = path.join(dir, 'connections');
  const subdirs = await listSubdirs(connDir);
  for (const name of subdirs) {
    if (accept && !accept(name)) continue;
    if (existing.has(name)) continue;
    const connPath = path.join(connDir, name);
    const specJson = await readOptionalFile(path.join(connPath, 'spec.json'));
    if (!specJson) {
      const hasOverrideFile = await readOptionalFile(path.join(connPath, 'surface.md'))
        ?? await readOptionalFile(path.join(connPath, 'access.json'))
        ?? await readOptionalFile(path.join(connPath, 'entities.md'))
        ?? await readOptionalFile(path.join(connPath, 'rules.md'));
      if (hasOverrideFile) continue;
      warnings.push(`Connection ${name} missing spec.json in ${dir}`);
      continue;
    }

    const accessJson = await readOptionalFile(path.join(connPath, 'access.json'));
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

async function loadPackageConnections(
  pkgDir: string,
  repoPath: string,
  existing: Map<string, LoadedConnection>,
  warnings: string[],
  accept?: (name: string) => boolean,
): Promise<void> {
  const connDir = path.join(pkgDir, 'connections');
  const subdirs = await listSubdirs(connDir);
  for (const name of subdirs) {
    if (accept && !accept(name)) continue;
    if (existing.has(name)) continue;

    const packageConnPath = path.join(connDir, name);
    const localConnPath = path.join(repoPath, 'connections', name);
    const packageSpecJson = await readOptionalFile(path.join(packageConnPath, 'spec.json'));
    if (!packageSpecJson) {
      warnings.push(`Connection ${name} missing spec.json in ${pkgDir}`);
      continue;
    }

    const packageAccessJson = await readOptionalFile(path.join(packageConnPath, 'access.json'));
    const localAccessJson = await readOptionalFile(path.join(localConnPath, 'access.json'));
    const packageSurfaceMd = await readOptionalFile(path.join(packageConnPath, 'surface.md')) ?? undefined;
    const localSurfaceMd = await readOptionalFile(path.join(localConnPath, 'surface.md')) ?? undefined;
    const surfaceMd = packageSurfaceMd && localSurfaceMd
      ? mergeSurface(packageSurfaceMd, localSurfaceMd)
      : localSurfaceMd ?? packageSurfaceMd;
    const entitiesMd = await readOptionalFile(path.join(localConnPath, 'entities.md'))
      ?? await readOptionalFile(path.join(packageConnPath, 'entities.md'))
      ?? undefined;
    const rulesMd = await readOptionalFile(path.join(localConnPath, 'rules.md'))
      ?? await readOptionalFile(path.join(packageConnPath, 'rules.md'))
      ?? undefined;
    const accessJson = packageAccessJson && localAccessJson
      ? JSON.stringify(mergeAccessJson(packageAccessJson, localAccessJson))
      : localAccessJson ?? packageAccessJson ?? '{"endpoints":{}}';

    try {
      const conn = parseConnection(name, {specJson: packageSpecJson, accessJson, surfaceMd, entitiesMd, rulesMd}, packageConnPath);
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
  accept?: (name: string) => boolean,
): Promise<void> {
  const skillDir = path.join(dir, 'skills');
  const subdirs = await listSubdirs(skillDir);
  for (const name of subdirs) {
    if (accept && !accept(name)) continue;
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
  accept?: (name: string) => boolean,
): Promise<void> {
  const autoDir = path.join(dir, 'automations');
  const files = await listFiles(autoDir);
  for (const file of files) {
    if (!file.endsWith('.json') && !file.endsWith('.md')) continue;
    const name = file.replace(/\.(json|md)$/, '');
    if (accept && !accept(name)) continue;
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
  accept?: (name: string) => boolean,
): Promise<void> {
  const kbDir = path.join(dir, 'knowledge');
  const files = await listFiles(kbDir, '.md');
  for (const file of files) {
    const name = file.replace(/\.md$/, '');
    if (accept && !accept(name)) continue;
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
  accept?: (name: string) => boolean,
): Promise<void> {
  const storeDir = path.join(dir, 'stores');
  const files = await listFiles(storeDir, '.json');
  for (const file of files) {
    const name = file.replace(/\.json$/, '');
    if (accept && !accept(name)) continue;
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
  accept?: (name: string) => boolean,
): Promise<void> {
  try {
    const loaded = await loadTools(dir);
    for (const tool of loaded) {
      if (accept && !accept(tool.name)) continue;
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
  const channels: ResolvedChannel[] = [];

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

  // 2. Load from declared npm packages (same nested structure as local repo).
  //    Each entry can be a bare string (load all sub-things) or an object
  //    with `use: ["<kind>.<name>", ...]` to opt into a subset of a
  //    multi-role package. See `normalizePackageEntry` / `buildSubthingFilter`.
  const declaredPackages = config?.packages;
  if (declaredPackages && declaredPackages.length > 0) {
    for (const rawEntry of declaredPackages) {
      const {package: npmName, use} = normalizePackageEntry(rawEntry);
      const pkgDir = await resolvePackageDir(repoPath, npmName);
      if (!pkgDir) {
        warnings.push(`Package "${npmName}" declared in amodal.json but not installed. Run: npm install`);
        continue;
      }
      const acceptConn = buildSubthingFilter(use, 'connections');
      const acceptSkill = buildSubthingFilter(use, 'skills');
      const acceptAuto = buildSubthingFilter(use, 'automations');
      const acceptKb = buildSubthingFilter(use, 'knowledge');
      const acceptStore = buildSubthingFilter(use, 'stores');
      const acceptTool = buildSubthingFilter(use, 'tools');
      const acceptChannel = buildSubthingFilter(use, 'channels');

      // Scan package for all content types — same loaders as local repo
      await loadPackageConnections(pkgDir, repoPath, connections, warnings, acceptConn);
      await loadLocalSkills(pkgDir, skillNames, skills, warnings, acceptSkill);
      await loadLocalAutomations(pkgDir, automationNames, automations, warnings, acceptAuto);
      await loadLocalKnowledge(pkgDir, knowledgeNames, knowledge, warnings, acceptKb);
      await loadLocalStores(pkgDir, storeNames, stores, warnings, acceptStore);
      await loadLocalTools(pkgDir, toolNames, tools, warnings, acceptTool);

      // Scan channels/<name>/channel.json — marks this package as a channel plugin
      const channelsDir = path.join(pkgDir, 'channels');
      const channelSubdirs = await listSubdirs(channelsDir);
      for (const channelName of channelSubdirs) {
        if (!acceptChannel(channelName)) continue;
        const channelJson = await readOptionalFile(path.join(channelsDir, channelName, 'channel.json'));
        if (!channelJson) continue;
        try {
          // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- parsing external JSON
          const parsed = JSON.parse(channelJson) as Record<string, unknown>;
          const channelType = String(parsed['type'] ?? channelName);
          // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- narrowing parsed config
          const channelConfig = (parsed['config'] ?? {}) as Record<string, unknown>;
          channels.push({channelType, packageName: npmName, packageDir: pkgDir, config: channelConfig});
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          warnings.push(`Failed to parse channel.json in "${npmName}/${channelName}": ${msg}`);
        }
      }
    }
  }

  return {connections, skills, automations, knowledge, stores, tools, channels, warnings};
}
