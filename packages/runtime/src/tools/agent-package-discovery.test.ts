/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

/**
 * Integration test for Phase 0.3 — confirms the existing tool-loader
 * (`@amodalai/core/repo/tool-loader.ts`) walks an agent package's
 * `tools/<name>/{tool.json, handler.ts}` layout and that the new
 * permission loader (`@amodalai/runtime/tools/permissions.ts`) reads
 * the same package's `package.json#amodal.permissions` declaration.
 *
 * The build plan calls for "auto-discovery from `<agentPackage>/tools/*\/`"
 * — same path the runtime already uses for user-authored custom tools.
 * This test pins that contract so future refactors can't silently drop
 * agent-package support.
 */

import {mkdir, mkdtemp, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import * as path from 'node:path';

import {afterEach, beforeEach, describe, expect, it} from 'vitest';

import {loadTools} from '@amodalai/core';

import {loadPackagePermissions} from './permissions.js';

describe('agent-package tool auto-discovery (Phase 0.3 contract)', () => {
  let pkgDir: string;

  beforeEach(async () => {
    pkgDir = await mkdtemp(path.join(tmpdir(), 'agent-pkg-'));
  });

  afterEach(async () => {
    await rm(pkgDir, {recursive: true, force: true});
  });

  it('discovers tools under <pkgDir>/tools/<name>/ and reads declared permissions from package.json#amodal.permissions', async () => {
    // Lay out an agent package the way agent-admin / connection-* / template-* do.
    await writeFile(
      path.join(pkgDir, 'package.json'),
      JSON.stringify({
        name: '@amodalai/agent-admin',
        amodal: {
          permissions: ['fs.read', 'fs.write', 'db.read', 'db.write'],
        },
      }),
      'utf-8',
    );
    const toolDir = path.join(pkgDir, 'tools', 'show_preview');
    await mkdir(toolDir, {recursive: true});
    await writeFile(
      path.join(toolDir, 'tool.json'),
      JSON.stringify({
        description: 'Show an agent card preview inline in chat.',
        parameters: {
          type: 'object',
          properties: {title: {type: 'string'}},
          required: ['title'],
        },
      }),
      'utf-8',
    );
    await writeFile(
      path.join(toolDir, 'handler.ts'),
      // No imports — just the bare shape that the runtime's tool executor
      // dynamically loads. Phase 0 doesn't compile/execute it; the
      // discovery test only cares that the loader sees the file.
      'export default async () => ({ ok: true });\n',
      'utf-8',
    );

    const [tools, permissions] = await Promise.all([
      loadTools(pkgDir),
      loadPackagePermissions(pkgDir),
    ]);

    expect(tools).toHaveLength(1);
    expect(tools[0]).toMatchObject({
      name: 'show_preview',
      description: 'Show an agent card preview inline in chat.',
      handlerPath: path.join(toolDir, 'handler.ts'),
    });

    expect(permissions).toEqual({
      packageName: '@amodalai/agent-admin',
      permissions: ['fs.read', 'fs.write', 'db.read', 'db.write'],
    });
  });

  it('returns empty permissions when an agent package omits the amodal.permissions block (default-deny)', async () => {
    await writeFile(
      path.join(pkgDir, 'package.json'),
      JSON.stringify({name: '@amodalai/some-template'}),
      'utf-8',
    );
    // Tool dir present but no permissions declared.
    const toolDir = path.join(pkgDir, 'tools', 'noop');
    await mkdir(toolDir, {recursive: true});
    await writeFile(
      path.join(toolDir, 'tool.json'),
      JSON.stringify({description: 'Does nothing.'}),
      'utf-8',
    );
    await writeFile(path.join(toolDir, 'handler.ts'), 'export default async () => ({});\n', 'utf-8');

    const [tools, permissions] = await Promise.all([
      loadTools(pkgDir),
      loadPackagePermissions(pkgDir),
    ]);

    expect(tools).toHaveLength(1);
    expect(permissions.permissions).toEqual([]);
  });

  it('returns empty arrays for a directory without tools/', async () => {
    await writeFile(path.join(pkgDir, 'package.json'), JSON.stringify({name: '@amodalai/empty'}), 'utf-8');
    const tools = await loadTools(pkgDir);
    expect(tools).toEqual([]);
  });
});
