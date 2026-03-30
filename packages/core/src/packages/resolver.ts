/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import {readFile, readdir, stat} from 'node:fs/promises';
import * as path from 'node:path';

import type {LoadedConnection} from '../repo/connection-types.js';
import {parseConnection, parseSkill, parseKnowledge, parseAutomation} from '../repo/parsers.js';
import type {LoadedAutomation, LoadedKnowledge, LoadedSkill} from '../repo/repo-types.js';

import {parseJsonImport, parseMarkdownFrontmatter} from './frontmatter.js';
import {mergeAccessJson, mergeConcatenation, mergeEntities, mergeSpecJson, mergeSurface} from './merge-engine.js';
import {readPackageFile} from './manifest-reader.js';
import {getPackageDir} from './npm-context.js';
import {makePackageRef, parsePackageKey} from './package-types.js';
import type {LockFile, PackageType} from './package-types.js';

/**
 * The result of resolving all installed + hand-written packages.
 */
export interface ResolvedPackages {
  connections: Map<string, LoadedConnection>;
  skills: LoadedSkill[];
  automations: LoadedAutomation[];
  knowledge: LoadedKnowledge[];
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

function hasImportHeader(content: string): boolean {
  // JSON import
  if (content.trim().startsWith('{')) {
    try {
      const {import: imp} = parseJsonImport(content);
      return imp !== undefined;
    } catch {
      return false;
    }
  }
  // Markdown import
  const {frontmatter} = parseMarkdownFrontmatter(content);
  return frontmatter !== null && typeof frontmatter['import'] === 'string';
}

// --- Connection resolution ---

/**
 * Resolve a single connection by merging package + repo files.
 */
export async function resolveConnection(
  name: string,
  repoDir: string | null,
  packageDir: string | null,
): Promise<LoadedConnection | null> {
  if (!repoDir && !packageDir) return null;

  const location = repoDir ?? packageDir!;

  // Helper to read from package
  async function readPkg(filename: string): Promise<string | null> {
    if (!packageDir) return null;
    return readPackageFile(packageDir, filename);
  }

  // Helper to read from repo
  async function readRepo(filename: string): Promise<string | null> {
    if (!repoDir) return null;
    return readOptionalFile(path.join(repoDir, filename));
  }

  // Resolve each file type with merge logic
  const repoSpec = await readRepo('spec.json');
  const pkgSpec = await readPkg('spec.json');
  let specJson: string;
  if (repoSpec && pkgSpec && hasImportHeader(repoSpec)) {
    const merged = mergeSpecJson(pkgSpec, repoSpec);
    specJson = JSON.stringify(merged);
  } else if (repoSpec) {
    specJson = repoSpec;
  } else if (pkgSpec) {
    specJson = pkgSpec;
  } else {
    return null; // spec.json is required
  }

  const repoAccess = await readRepo('access.json');
  const pkgAccess = await readPkg('access.json');
  let accessJson: string;
  if (repoAccess && pkgAccess && hasImportHeader(repoAccess)) {
    const merged = mergeAccessJson(pkgAccess, repoAccess);
    accessJson = JSON.stringify(merged);
  } else if (repoAccess) {
    accessJson = repoAccess;
  } else if (pkgAccess) {
    accessJson = pkgAccess;
  } else {
    return null; // access.json is required
  }

  // surface.md (optional)
  const repoSurface = await readRepo('surface.md');
  const pkgSurface = await readPkg('surface.md');
  let surfaceMd: string | undefined;
  if (repoSurface && pkgSurface && hasImportHeader(repoSurface)) {
    surfaceMd = mergeSurface(pkgSurface, repoSurface);
  } else if (repoSurface) {
    surfaceMd = repoSurface;
  } else if (pkgSurface) {
    surfaceMd = pkgSurface;
  }

  // entities.md (optional)
  const repoEntities = await readRepo('entities.md');
  const pkgEntities = await readPkg('entities.md');
  let entitiesMd: string | undefined;
  if (repoEntities && pkgEntities && hasImportHeader(repoEntities)) {
    entitiesMd = mergeEntities(pkgEntities, repoEntities);
  } else if (repoEntities) {
    entitiesMd = repoEntities;
  } else if (pkgEntities) {
    entitiesMd = pkgEntities;
  }

  // rules.md (optional, concatenation)
  const repoRules = await readRepo('rules.md');
  const pkgRules = await readPkg('rules.md');
  let rulesMd: string | undefined;
  if (repoRules && pkgRules && hasImportHeader(repoRules)) {
    rulesMd = mergeConcatenation(pkgRules, repoRules);
  } else if (repoRules) {
    rulesMd = repoRules;
  } else if (pkgRules) {
    rulesMd = pkgRules;
  }

  return parseConnection(name, {specJson, accessJson, surfaceMd, entitiesMd, rulesMd}, location);
}

// --- Skill resolution ---

/**
 * Resolve a single skill by merging package + repo files.
 */
export async function resolveSkill(
  name: string,
  repoDir: string | null,
  packageDir: string | null,
): Promise<LoadedSkill | null> {
  if (!repoDir && !packageDir) return null;

  const location = repoDir ?? packageDir!;

  const repoContent = repoDir
    ? await readOptionalFile(path.join(repoDir, 'SKILL.md'))
    : null;
  const pkgContent = packageDir
    ? await readPackageFile(packageDir, 'SKILL.md')
    : null;

  let content: string | null = null;
  if (repoContent && pkgContent && hasImportHeader(repoContent)) {
    content = mergeConcatenation(pkgContent, repoContent);
  } else if (repoContent) {
    content = repoContent;
  } else if (pkgContent) {
    content = pkgContent;
  }

  if (!content) return null;
  return parseSkill(content, location);
}

// --- Automation resolution ---

/**
 * Resolve a single automation by merging package + repo file.
 */
export async function resolveAutomation(
  name: string,
  repoDir: string | null,
  packageDir: string | null,
): Promise<LoadedAutomation | null> {
  if (!repoDir && !packageDir) return null;

  const location = repoDir ?? packageDir!;

  const repoContent = repoDir
    ? (await readOptionalFile(path.join(repoDir, `${name}.json`)) ?? await readOptionalFile(path.join(repoDir, `${name}.md`)))
    : null;
  const pkgContent = packageDir
    ? (await readPackageFile(packageDir, `${name}.json`).catch(() => null) ?? await readPackageFile(packageDir, `${name}.md`))
    : null;

  let content: string | null = null;
  if (repoContent && pkgContent && hasImportHeader(repoContent)) {
    content = mergeConcatenation(pkgContent, repoContent);
  } else if (repoContent) {
    content = repoContent;
  } else if (pkgContent) {
    content = pkgContent;
  }

  if (!content) return null;
  return parseAutomation(content, name, location);
}

// --- Knowledge resolution ---

/**
 * Resolve a single knowledge file by merging package + repo file.
 */
export async function resolveKnowledge(
  name: string,
  repoDir: string | null,
  packageDir: string | null,
): Promise<LoadedKnowledge | null> {
  if (!repoDir && !packageDir) return null;

  const location = repoDir ?? packageDir!;

  const repoContent = repoDir
    ? await readOptionalFile(path.join(repoDir, `${name}.md`))
    : null;
  const pkgContent = packageDir
    ? await readPackageFile(packageDir, `${name}.md`)
    : null;

  let content: string | null = null;
  if (repoContent && pkgContent && hasImportHeader(repoContent)) {
    content = mergeConcatenation(pkgContent, repoContent);
  } else if (repoContent) {
    content = repoContent;
  } else if (pkgContent) {
    content = pkgContent;
  }

  if (!content) return null;
  return parseKnowledge(content, name, location);
}

// --- Full resolution ---

/**
 * Resolve all packages: merge lock file packages with repo directories.
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

  // Build union of names from lock file + repo directories
  const connectionNames = new Set<string>();
  const skillNames = new Set<string>();
  const automationNames = new Set<string>();
  const knowledgeNames = new Set<string>();

  // From lock file
  if (lockFile) {
    for (const key of Object.keys(lockFile.packages)) {
      const parsed = parsePackageKey(key);
      switch (parsed.type) {
        case 'connection':
          connectionNames.add(parsed.name);
          break;
        case 'skill':
          skillNames.add(parsed.name);
          break;
        case 'automation':
          automationNames.add(parsed.name);
          break;
        case 'knowledge':
          knowledgeNames.add(parsed.name);
          break;
        default:
          break;
      }
    }
  }

  // From repo directories
  const connDirs = await listSubdirs(path.join(repoPath, 'connections'));
  for (const d of connDirs) connectionNames.add(d);

  const skillDirs = await listSubdirs(path.join(repoPath, 'skills'));
  for (const d of skillDirs) skillNames.add(d);

  // For automations and knowledge, list .md files
  const autoDir = path.join(repoPath, 'automations');
  const knowledgeDir = path.join(repoPath, 'knowledge');

  try {
    const autoFiles = await readdir(autoDir);
    for (const f of autoFiles) {
      if (f.endsWith('.md')) automationNames.add(f.replace(/\.md$/, ''));
      if (f.endsWith('.json')) automationNames.add(f.replace(/\.json$/, ''));
    }
  } catch {
    // Directory doesn't exist
  }

  try {
    const knowledgeFiles = await readdir(knowledgeDir);
    for (const f of knowledgeFiles) {
      if (f.endsWith('.md')) knowledgeNames.add(f.replace(/\.md$/, ''));
    }
  } catch {
    // Directory doesn't exist
  }

  // Helper to get package directory for a name
  async function getPkgDir(type: PackageType, name: string): Promise<string | null> {
    const ref = makePackageRef(type, name);
    const dir = await getPackageDir(repoPath, ref);
    if (!dir && lockFile && lockFile.packages[ref.key]) {
      warnings.push(`Package ${ref.key} is in lock file but not installed (broken symlink?)`);
    }
    return dir;
  }

  // Resolve connections
  const connTasks = [...connectionNames].map(async (name) => {
    const repoDir = path.join(repoPath, 'connections', name);
    const repoDirExists = await dirExists(repoDir);
    const pkgDir = await getPkgDir('connection', name);
    const result = await resolveConnection(
      name,
      repoDirExists ? repoDir : null,
      pkgDir,
    );
    if (result) connections.set(name, result);
  });

  // Resolve skills
  const skillTasks = [...skillNames].map(async (name) => {
    const repoDir = path.join(repoPath, 'skills', name);
    const repoDirExists = await dirExists(repoDir);
    const pkgDir = await getPkgDir('skill', name);
    const result = await resolveSkill(
      name,
      repoDirExists ? repoDir : null,
      pkgDir,
    );
    if (result) skills.push(result);
  });

  // Resolve automations
  const autoTasks = [...automationNames].map(async (name) => {
    const repoDir = path.join(repoPath, 'automations');
    const repoDirExists = await dirExists(repoDir);
    const pkgDir = await getPkgDir('automation', name);
    const result = await resolveAutomation(
      name,
      repoDirExists ? repoDir : null,
      pkgDir,
    );
    if (result) automations.push(result);
  });

  // Resolve knowledge
  const knowledgeTasks = [...knowledgeNames].map(async (name) => {
    const repoDir = path.join(repoPath, 'knowledge');
    const repoDirExists = await dirExists(repoDir);
    const pkgDir = await getPkgDir('knowledge', name);
    const result = await resolveKnowledge(
      name,
      repoDirExists ? repoDir : null,
      pkgDir,
    );
    if (result) knowledge.push(result);
  });

  await Promise.all([...connTasks, ...skillTasks, ...autoTasks, ...knowledgeTasks]);

  return {connections, skills, automations, knowledge, warnings};
}
