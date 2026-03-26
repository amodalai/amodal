/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import {describe, it, expect, beforeEach, afterEach} from 'vitest';
import {mkdtempSync, mkdirSync, writeFileSync, rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {loadTools} from './tool-loader.js';

describe('loadTools', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'tool-loader-test-'));
  });

  afterEach(() => {
    rmSync(tempDir, {recursive: true, force: true});
  });

  function createToolWithJson(
    name: string,
    toolJson: Record<string, unknown>,
    options?: {noHandler?: boolean; withPackageJson?: boolean},
  ) {
    const toolDir = join(tempDir, 'tools', name);
    mkdirSync(toolDir, {recursive: true});
    writeFileSync(join(toolDir, 'tool.json'), JSON.stringify(toolJson));
    if (!options?.noHandler) {
      writeFileSync(join(toolDir, 'handler.ts'), 'export default async (params: any) => params;');
    }
    if (options?.withPackageJson) {
      writeFileSync(join(toolDir, 'package.json'), JSON.stringify({name, dependencies: {}}));
    }
  }

  function createSingleFileTool(name: string, handlerContent: string) {
    const toolDir = join(tempDir, 'tools', name);
    mkdirSync(toolDir, {recursive: true});
    writeFileSync(join(toolDir, 'handler.ts'), handlerContent);
  }

  // ── tool.json mode ──

  it('returns empty array when tools/ directory does not exist', async () => {
    const result = await loadTools(tempDir);
    expect(result).toEqual([]);
  });

  it('returns empty array when tools/ directory is empty', async () => {
    mkdirSync(join(tempDir, 'tools'));
    const result = await loadTools(tempDir);
    expect(result).toEqual([]);
  });

  it('loads a valid tool with tool.json', async () => {
    createToolWithJson('pipeline_value', {
      description: 'Calculate weighted pipeline value',
      parameters: {type: 'object', properties: {deal_ids: {type: 'array'}}},
    });

    const tools = await loadTools(tempDir);
    expect(tools).toHaveLength(1);
    expect(tools[0].name).toBe('pipeline_value');
    expect(tools[0].description).toBe('Calculate weighted pipeline value');
    expect(tools[0].confirm).toBe(false);
    expect(tools[0].timeout).toBe(30000);
    expect(tools[0].env).toEqual([]);
    expect(tools[0].handlerPath).toContain('handler.ts');
    expect(tools[0].hasPackageJson).toBe(false);
    expect(tools[0].hasDockerfile).toBe(false);
    expect(tools[0].hasSetupScript).toBe(false);
    expect(tools[0].hasRequirementsTxt).toBe(false);
    expect(tools[0].sandboxLanguage).toBe('typescript');
  });

  it('detects Dockerfile', async () => {
    const toolDir = join(tempDir, 'tools', 'docker_tool');
    mkdirSync(toolDir, {recursive: true});
    writeFileSync(join(toolDir, 'tool.json'), JSON.stringify({description: 'Docker tool'}));
    writeFileSync(join(toolDir, 'handler.ts'), 'export default async () => ({});');
    writeFileSync(join(toolDir, 'Dockerfile'), 'FROM python:3.12-slim\nWORKDIR /tool\nCOPY . .');

    const tools = await loadTools(tempDir);
    expect(tools[0].hasDockerfile).toBe(true);
    expect(tools[0].hasSetupScript).toBe(false);
  });

  it('detects setup.sh and requirements.txt', async () => {
    const toolDir = join(tempDir, 'tools', 'setup_tool');
    mkdirSync(toolDir, {recursive: true});
    writeFileSync(join(toolDir, 'tool.json'), JSON.stringify({
      description: 'Setup tool',
      sandbox: {language: 'python'},
    }));
    writeFileSync(join(toolDir, 'handler.ts'), 'export default async () => ({});');
    writeFileSync(join(toolDir, 'setup.sh'), '#!/bin/bash\npip install pandas');
    writeFileSync(join(toolDir, 'requirements.txt'), 'pandas\nnumpy');

    const tools = await loadTools(tempDir);
    expect(tools[0].hasSetupScript).toBe(true);
    expect(tools[0].hasRequirementsTxt).toBe(true);
    expect(tools[0].hasDockerfile).toBe(false);
    expect(tools[0].sandboxLanguage).toBe('python');
  });

  it('detects both Dockerfile and setup.sh', async () => {
    const toolDir = join(tempDir, 'tools', 'both_tool');
    mkdirSync(toolDir, {recursive: true});
    writeFileSync(join(toolDir, 'tool.json'), JSON.stringify({description: 'Both'}));
    writeFileSync(join(toolDir, 'handler.ts'), 'export default async () => ({});');
    writeFileSync(join(toolDir, 'Dockerfile'), 'FROM node:22');
    writeFileSync(join(toolDir, 'setup.sh'), '#!/bin/bash\nnpm install');

    const tools = await loadTools(tempDir);
    expect(tools[0].hasDockerfile).toBe(true);
    expect(tools[0].hasSetupScript).toBe(true);
  });

  it('uses directory name as tool name (ignores name field if absent)', async () => {
    createToolWithJson('my_tool', {
      description: 'My tool',
      parameters: {},
    });

    const tools = await loadTools(tempDir);
    expect(tools[0].name).toBe('my_tool');
  });

  it('accepts matching name in tool.json', async () => {
    createToolWithJson('my_tool', {
      name: 'my_tool',
      description: 'My tool',
      parameters: {},
    });

    const tools = await loadTools(tempDir);
    expect(tools[0].name).toBe('my_tool');
  });

  it('rejects mismatched name in tool.json', async () => {
    createToolWithJson('my_tool', {
      name: 'different_name',
      description: 'My tool',
      parameters: {},
    });

    await expect(loadTools(tempDir)).rejects.toThrow(/does not match directory name/);
  });

  it('loads multiple tools', async () => {
    createToolWithJson('tool_a', {description: 'Tool A', parameters: {}});
    createToolWithJson('tool_b', {description: 'Tool B', parameters: {}});

    const tools = await loadTools(tempDir);
    expect(tools).toHaveLength(2);
    const names = tools.map((t) => t.name).sort();
    expect(names).toEqual(['tool_a', 'tool_b']);
  });

  it('detects package.json', async () => {
    createToolWithJson('with_deps', {
      description: 'Tool with deps',
      parameters: {},
    }, {withPackageJson: true});

    const tools = await loadTools(tempDir);
    expect(tools[0].hasPackageJson).toBe(true);
  });

  it('throws when handler.ts is missing', async () => {
    createToolWithJson('no_handler', {
      description: 'Missing handler',
      parameters: {},
    }, {noHandler: true});

    await expect(loadTools(tempDir)).rejects.toThrow(/Missing handler\.ts/);
  });

  it('throws when tool.json has invalid JSON', async () => {
    const toolDir = join(tempDir, 'tools', 'bad_json');
    mkdirSync(toolDir, {recursive: true});
    writeFileSync(join(toolDir, 'tool.json'), '{invalid json}');
    writeFileSync(join(toolDir, 'handler.ts'), 'export default async () => {};');

    await expect(loadTools(tempDir)).rejects.toThrow(/Invalid JSON/);
  });

  it('throws when tool.json fails validation', async () => {
    createToolWithJson('bad_schema', {
      // Missing required description
      parameters: {},
    });

    await expect(loadTools(tempDir)).rejects.toThrow(/Invalid tool\.json/);
  });

  it('rejects invalid directory names', async () => {
    const toolDir = join(tempDir, 'tools', 'Bad-Name');
    mkdirSync(toolDir, {recursive: true});
    writeFileSync(join(toolDir, 'tool.json'), JSON.stringify({description: 'Bad', parameters: {}}));
    writeFileSync(join(toolDir, 'handler.ts'), 'export default async () => {};');

    await expect(loadTools(tempDir)).rejects.toThrow(/not a valid tool name/);
  });

  it('preserves responseShaping', async () => {
    createToolWithJson('with_shaping', {
      description: 'Shaped response',
      parameters: {},
      responseShaping: {path: 'data.items', maxLength: 1000},
    });

    const tools = await loadTools(tempDir);
    expect(tools[0].responseShaping?.path).toBe('data.items');
    expect(tools[0].responseShaping?.maxLength).toBe(1000);
  });

  it('preserves confirm, timeout, and env values', async () => {
    createToolWithJson('configured', {
      description: 'Configured tool',
      parameters: {},
      confirm: 'review',
      timeout: 60000,
      env: ['MY_KEY'],
    });

    const tools = await loadTools(tempDir);
    expect(tools[0].confirm).toBe('review');
    expect(tools[0].timeout).toBe(60000);
    expect(tools[0].env).toEqual(['MY_KEY']);
  });

  // ── single-file mode (no tool.json) ──

  it('loads tool from handler.ts with export const description', async () => {
    createSingleFileTool('simple_tool', `
export const description = "A simple computation tool";
export default async (params: any) => ({ result: 42 });
`);

    const tools = await loadTools(tempDir);
    expect(tools).toHaveLength(1);
    expect(tools[0].name).toBe('simple_tool');
    expect(tools[0].description).toBe('A simple computation tool');
    expect(tools[0].parameters).toEqual({});
    expect(tools[0].confirm).toBe(false);
    expect(tools[0].timeout).toBe(30000);
  });

  it('loads tool from handler.ts with defineToolHandler', async () => {
    createSingleFileTool('defined_tool', `
import { defineToolHandler } from '@amodalai/core';
export default defineToolHandler({
  description: "Calculate pipeline value",
  parameters: { type: 'object' },
  handler: async (params, ctx) => ({ total: 100 }),
});
`);

    const tools = await loadTools(tempDir);
    expect(tools).toHaveLength(1);
    expect(tools[0].name).toBe('defined_tool');
    expect(tools[0].description).toBe('Calculate pipeline value');
  });

  it('throws when handler.ts has no description (single-file mode)', async () => {
    createSingleFileTool('no_desc', `
export default async () => ({});
`);

    await expect(loadTools(tempDir)).rejects.toThrow(/no description found/);
  });

  it('handles double-quoted description export', async () => {
    createSingleFileTool('dq_tool',
      'export const description = "Double quoted";\nexport default async () => ({});',
    );

    const tools = await loadTools(tempDir);
    expect(tools[0].description).toBe('Double quoted');
  });

  it('handles single-quoted description export', async () => {
    createSingleFileTool('sq_tool',
      "export const description = 'Single quoted';\nexport default async () => ({});",
    );

    const tools = await loadTools(tempDir);
    expect(tools[0].description).toBe('Single quoted');
  });
});
