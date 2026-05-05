/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import {describe, it, expect, beforeEach, afterEach} from 'vitest';
import {mkdtemp, mkdir, writeFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import * as path from 'node:path';
import {loadIntents} from './loader.js';

describe('loadIntents', () => {
  let repoPath: string;

  beforeEach(async () => {
    repoPath = await mkdtemp(path.join(tmpdir(), 'intent-loader-test-'));
  });

  afterEach(async () => {
    await rm(repoPath, {recursive: true, force: true});
  });

  it('returns empty array when intents/ does not exist', async () => {
    const intents = await loadIntents(repoPath);
    expect(intents).toEqual([]);
  });

  it('loads a single valid intent', async () => {
    const intentDir = path.join(repoPath, 'intents', 'echo');
    await mkdir(intentDir, {recursive: true});
    await writeFile(
      path.join(intentDir, 'intent.ts'),
      `export default {
        id: 'echo',
        regex: /^echo (.+)$/,
        async handle(ctx) { return {}; },
      };`,
    );
    const intents = await loadIntents(repoPath);
    expect(intents).toHaveLength(1);
    expect(intents[0].id).toBe('echo');
    expect(intents[0].regex.source).toBe('^echo (.+)$');
  });

  it('loads multiple intents alphabetically sorted', async () => {
    for (const id of ['banana', 'apple', 'cherry']) {
      const intentDir = path.join(repoPath, 'intents', id);
      await mkdir(intentDir, {recursive: true});
      await writeFile(
        path.join(intentDir, 'intent.ts'),
        `export default { id: '${id}', regex: /^${id}$/, async handle() { return {}; } };`,
      );
    }
    const intents = await loadIntents(repoPath);
    expect(intents.map((i) => i.id)).toEqual(['apple', 'banana', 'cherry']);
  });

  it('skips subdirs without intent.ts', async () => {
    await mkdir(path.join(repoPath, 'intents', 'just-a-folder'), {recursive: true});
    const intents = await loadIntents(repoPath);
    expect(intents).toEqual([]);
  });

  it('skips dot- and underscore-prefixed entries', async () => {
    for (const name of ['.hidden', '_private', '.build']) {
      const dir = path.join(repoPath, 'intents', name);
      await mkdir(dir, {recursive: true});
      await writeFile(
        path.join(dir, 'intent.ts'),
        `export default { id: 'shouldnotload', regex: /^x$/, async handle() { return {}; } };`,
      );
    }
    const intents = await loadIntents(repoPath);
    expect(intents).toEqual([]);
  });

  it('rejects malformed default export', async () => {
    const intentDir = path.join(repoPath, 'intents', 'bad');
    await mkdir(intentDir, {recursive: true});
    await writeFile(
      path.join(intentDir, 'intent.ts'),
      `export default { id: 'bad', regex: 'not-a-regex', handle: 42 };`,
    );
    await expect(loadIntents(repoPath)).rejects.toThrow(/IntentDefinition/);
  });

  it('rejects id mismatch with directory name', async () => {
    const intentDir = path.join(repoPath, 'intents', 'directory-name');
    await mkdir(intentDir, {recursive: true});
    await writeFile(
      path.join(intentDir, 'intent.ts'),
      `export default { id: 'different-id', regex: /^x$/, async handle() { return {}; } };`,
    );
    await expect(loadIntents(repoPath)).rejects.toThrow(/must match the directory name/);
  });

  it('inlines sibling .ts helpers via esbuild bundle', async () => {
    const intentDir = path.join(repoPath, 'intents', 'with-helper');
    await mkdir(intentDir, {recursive: true});
    await writeFile(
      path.join(intentDir, 'helper.ts'),
      `export const greeting = 'hi';`,
    );
    await writeFile(
      path.join(intentDir, 'intent.ts'),
      `import {greeting} from './helper.js';
       export default {
         id: 'with-helper',
         regex: new RegExp('^' + greeting + '$'),
         async handle() { return {}; },
       };`,
    );
    const intents = await loadIntents(repoPath);
    expect(intents).toHaveLength(1);
    expect(intents[0].regex.test('hi')).toBe(true);
  });
});
