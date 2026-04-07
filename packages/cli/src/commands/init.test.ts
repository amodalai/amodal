/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import {describe, it, expect, beforeEach, afterEach} from 'vitest';
import {mkdtempSync, rmSync, existsSync, readFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {runInit} from './init.js';

describe('runInit', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'amodal-init-'));
  });

  afterEach(() => {
    rmSync(tempDir, {recursive: true, force: true});
  });

  it('should create project directory structure', async () => {
    await runInit({
      cwd: tempDir,
      name: 'test-project',
      provider: 'anthropic',
    });

    expect(existsSync(join(tempDir, 'amodal.json'))).toBe(true);
    expect(existsSync(join(tempDir, 'connections'))).toBe(true);
    expect(existsSync(join(tempDir, 'skills'))).toBe(true);
    expect(existsSync(join(tempDir, 'knowledge'))).toBe(true);
    expect(existsSync(join(tempDir, 'automations'))).toBe(true);
    expect(existsSync(join(tempDir, 'evals'))).toBe(true);
    expect(existsSync(join(tempDir, '.gitignore'))).toBe(true);
    const gitignore = readFileSync(join(tempDir, '.gitignore'), 'utf-8');
    expect(gitignore).toContain('node_modules/');
    expect(gitignore).toContain('.env');
  });

  it('should write valid config.json', async () => {
    await runInit({
      cwd: tempDir,
      name: 'my-agent',
      provider: 'anthropic',
    });

    const config = JSON.parse(readFileSync(join(tempDir, 'amodal.json'), 'utf-8'));
    expect(config['name']).toBe('my-agent');
    expect(config['models']['main']['provider']).toBe('anthropic');
  });

  it('should not write starter files into directories', async () => {
    await runInit({cwd: tempDir});

    // Directories should exist but be empty — no fake/mock content
    expect(existsSync(join(tempDir, 'skills'))).toBe(true);
    expect(existsSync(join(tempDir, 'skills', 'SKILL.md'))).toBe(false);
    expect(existsSync(join(tempDir, 'knowledge'))).toBe(true);
    expect(existsSync(join(tempDir, 'knowledge', 'domain.md'))).toBe(false);
  });

  it('should skip if config already exists', async () => {
    // First run
    await runInit({cwd: tempDir, name: 'first'});
    const firstConfig = readFileSync(join(tempDir, 'amodal.json'), 'utf-8');

    // Second run should skip
    await runInit({cwd: tempDir, name: 'second'});
    const secondConfig = readFileSync(join(tempDir, 'amodal.json'), 'utf-8');

    expect(firstConfig).toBe(secondConfig);
  });

  it('should use OpenAI provider', async () => {
    await runInit({
      cwd: tempDir,
      name: 'openai-project',
      provider: 'openai',
    });

    const config = JSON.parse(readFileSync(join(tempDir, 'amodal.json'), 'utf-8'));
    expect(config['models']['main']['provider']).toBe('openai');
    expect(config['models']['main']['model']).toBe('gpt-4o');
  });

  it('should use Google provider', async () => {
    await runInit({
      cwd: tempDir,
      provider: 'google',
    });

    const config = JSON.parse(readFileSync(join(tempDir, 'amodal.json'), 'utf-8'));
    expect(config['models']['main']['provider']).toBe('google');
  });

  it('should default to anthropic provider', async () => {
    await runInit({cwd: tempDir});

    const config = JSON.parse(readFileSync(join(tempDir, 'amodal.json'), 'utf-8'));
    expect(config['models']['main']['provider']).toBe('anthropic');
  });
});
