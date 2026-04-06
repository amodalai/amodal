/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import {afterEach, beforeEach, describe, expect, it} from 'vitest';

import {resolveAllPackages} from './resolver.js';
import type {AmodalConfig} from '../repo/config-schema.js';

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'resolver-test-'));
});

afterEach(async () => {
  await fs.rm(tmpDir, {recursive: true, force: true});
});

// --- Helpers ---

async function writeRepoFiles(
  repoPath: string,
  subdir: string,
  name: string,
  files: Record<string, string>,
): Promise<void> {
  const dir = path.join(repoPath, subdir, name);
  await fs.mkdir(dir, {recursive: true});
  for (const [fname, content] of Object.entries(files)) {
    await fs.writeFile(path.join(dir, fname), content);
  }
}

/**
 * Set up a connection package in node_modules with nested layout:
 * node_modules/@amodalai/<npmShortName>/connections/<connName>/spec.json
 */
async function setupConnectionPackage(
  repoPath: string,
  npmName: string,
  connName: string,
  files: Record<string, string>,
): Promise<void> {
  const connDir = path.join(repoPath, 'node_modules', ...npmName.split('/'), 'connections', connName);
  await fs.mkdir(connDir, {recursive: true});
  for (const [fname, content] of Object.entries(files)) {
    await fs.writeFile(path.join(connDir, fname), content);
  }
}

/**
 * Set up a skill package in node_modules with nested layout:
 * node_modules/@scope/<name>/skills/<skillName>/SKILL.md
 */
async function setupSkillPackage(
  repoPath: string,
  npmName: string,
  skillMd: string,
): Promise<void> {
  // Derive skill name from npm name: @amodalai/skill-triage → triage
  const shortName = npmName.split('/').pop() ?? npmName;
  const skillName = shortName.replace(/^skill-/, '');
  const skillDir = path.join(repoPath, 'node_modules', ...npmName.split('/'), 'skills', skillName);
  await fs.mkdir(skillDir, {recursive: true});
  await fs.writeFile(path.join(skillDir, 'SKILL.md'), skillMd);
}

/**
 * Set up a knowledge package in node_modules with nested layout:
 * node_modules/@scope/<name>/knowledge/<knowledgeName>.md
 */
async function setupKnowledgePackage(
  repoPath: string,
  npmName: string,
  knowledgeMd: string,
): Promise<void> {
  const shortName = npmName.split('/').pop() ?? npmName;
  const kbName = shortName.replace(/^knowledge-/, '');
  const kbDir = path.join(repoPath, 'node_modules', ...npmName.split('/'), 'knowledge');
  await fs.mkdir(kbDir, {recursive: true});
  await fs.writeFile(path.join(kbDir, `${kbName}.md`), knowledgeMd);
}

function makeSpec(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    baseUrl: 'https://api.example.com',
    specUrl: 'https://api.example.com/openapi.json',
    format: 'openapi',
    ...overrides,
  });
}

function makeAccess(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    endpoints: {'GET /test': {returns: ['entity']}},
    ...overrides,
  });
}

function makeConfig(overrides: Partial<AmodalConfig> = {}): AmodalConfig {
  return {
    name: 'test-agent',
    version: '1.0.0',
    models: {main: {provider: 'test', model: 'test'}},
    ...overrides,
  } as AmodalConfig;
}

// --- resolveAllPackages ---

describe('resolveAllPackages', () => {
  it('resolves connection packages declared in config', async () => {
    await setupConnectionPackage(tmpDir, '@amodalai/connection-salesforce', 'salesforce', {
      'spec.json': makeSpec(),
      'access.json': makeAccess(),
    });

    const result = await resolveAllPackages({
      repoPath: tmpDir,
      config: makeConfig({packages: ['@amodalai/connection-salesforce']}),
    });
    expect(result.connections.size).toBe(1);
    expect(result.connections.has('salesforce')).toBe(true);
  });

  it('resolves hand-written repo items with no packages', async () => {
    await writeRepoFiles(tmpDir, 'connections', 'internal', {
      'spec.json': makeSpec({specUrl: 'internal'}),
      'access.json': makeAccess(),
    });

    const result = await resolveAllPackages({repoPath: tmpDir});
    expect(result.connections.size).toBe(1);
    expect(result.connections.get('internal')!.spec.specUrl).toBe('internal');
  });

  it('resolves mixed packages and hand-written', async () => {
    await setupConnectionPackage(tmpDir, '@amodalai/connection-salesforce', 'salesforce', {
      'spec.json': makeSpec(),
      'access.json': makeAccess(),
    });

    await writeRepoFiles(tmpDir, 'connections', 'internal', {
      'spec.json': makeSpec({specUrl: 'internal'}),
      'access.json': makeAccess(),
    });

    const result = await resolveAllPackages({
      repoPath: tmpDir,
      config: makeConfig({packages: ['@amodalai/connection-salesforce']}),
    });
    expect(result.connections.size).toBe(2);
  });

  it('handles no config and no local content', async () => {
    const result = await resolveAllPackages({repoPath: tmpDir});
    expect(result.connections.size).toBe(0);
    expect(result.skills).toHaveLength(0);
  });

  it('resolves skill packages declared in config', async () => {
    await setupSkillPackage(tmpDir, '@amodalai/skill-triage', '# Skill: Triage\nTriage methodology.\n\n## Steps\n1. Assess.');

    const result = await resolveAllPackages({
      repoPath: tmpDir,
      config: makeConfig({packages: ['@amodalai/skill-triage']}),
    });
    expect(result.skills).toHaveLength(1);
    expect(result.skills[0].name).toBe('Triage');
  });

  it('local repo wins over packages for same connection name', async () => {
    await setupConnectionPackage(tmpDir, '@amodalai/connection-salesforce', 'salesforce', {
      'spec.json': makeSpec({specUrl: 'package-source'}),
      'access.json': makeAccess(),
    });

    await writeRepoFiles(tmpDir, 'connections', 'salesforce', {
      'spec.json': makeSpec({specUrl: 'local-source'}),
      'access.json': makeAccess(),
    });

    const result = await resolveAllPackages({
      repoPath: tmpDir,
      config: makeConfig({packages: ['@amodalai/connection-salesforce']}),
    });
    expect(result.connections.size).toBe(1);
    expect(result.connections.get('salesforce')!.spec.specUrl).toBe('local-source');
  });

  it('loads multiple connection packages', async () => {
    await setupConnectionPackage(tmpDir, '@amodalai/connection-salesforce', 'salesforce', {
      'spec.json': makeSpec(),
      'access.json': makeAccess(),
    });
    await setupConnectionPackage(tmpDir, '@amodalai/connection-stripe', 'stripe', {
      'spec.json': makeSpec(),
      'access.json': makeAccess(),
    });

    const result = await resolveAllPackages({
      repoPath: tmpDir,
      config: makeConfig({packages: ['@amodalai/connection-salesforce', '@amodalai/connection-stripe']}),
    });
    expect(result.connections.size).toBe(2);
    expect(result.connections.has('salesforce')).toBe(true);
    expect(result.connections.has('stripe')).toBe(true);
  });

  it('returns warnings array', async () => {
    const result = await resolveAllPackages({repoPath: tmpDir});
    expect(result.warnings).toBeDefined();
    expect(Array.isArray(result.warnings)).toBe(true);
  });

  it('warns when declared package is not installed', async () => {
    const result = await resolveAllPackages({
      repoPath: tmpDir,
      config: makeConfig({packages: ['@amodalai/connection-missing']}),
    });
    expect(result.warnings.length).toBeGreaterThan(0);
    expect(result.warnings[0]).toContain('not installed');
  });

  it('resolves knowledge packages declared in config', async () => {
    await setupKnowledgePackage(tmpDir, '@amodalai/knowledge-guide', '# Knowledge: Alert Guide\n\nHow to handle alerts.');

    const result = await resolveAllPackages({
      repoPath: tmpDir,
      config: makeConfig({packages: ['@amodalai/knowledge-guide']}),
    });
    expect(result.knowledge).toHaveLength(1);
    expect(result.knowledge[0].title).toBe('Alert Guide');
  });

  it('supports arbitrary npm scopes', async () => {
    await setupConnectionPackage(tmpDir, '@my-org/connection-custom', 'custom', {
      'spec.json': makeSpec(),
      'access.json': makeAccess(),
    });

    const result = await resolveAllPackages({
      repoPath: tmpDir,
      config: makeConfig({packages: ['@my-org/connection-custom']}),
    });
    expect(result.connections.size).toBe(1);
    expect(result.connections.has('custom')).toBe(true);
  });
});
