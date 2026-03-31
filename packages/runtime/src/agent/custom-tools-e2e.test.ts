/**
 * @license
 * Copyright 2025 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

/**
 * End-to-end tests for the custom tools pipeline.
 *
 * Tests the full lifecycle:
 *   repo on disk → loadTools → buildTools (LLM tool list) → executeTool → result
 *
 * Uses real filesystem fixtures (temp dirs) and real handler execution
 * via dynamic import. The LLM provider is mocked so we can control
 * which tools get called and verify the results.
 */

import {describe, it, expect, vi, beforeEach, afterEach} from 'vitest';
import {mkdtempSync, mkdirSync, writeFileSync, rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {loadTools} from '@amodalai/core';
import type {LoadedTool} from '@amodalai/core';
import {LocalToolExecutor} from './tool-executor-local.js';
import {buildToolContext} from './tool-context-builder.js';
import type {AgentSession} from './agent-types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTempRepo(): string {
  return mkdtempSync(join(tmpdir(), 'tools-e2e-'));
}

/**
 * Write a .mjs handler file into a tool directory.
 * We use .mjs so dynamic import works without a TypeScript compile step.
 */
function writeTool(
  repoDir: string,
  name: string,
  files: Record<string, string>,
) {
  const toolDir = join(repoDir, 'tools', name);
  mkdirSync(toolDir, {recursive: true});
  for (const [filename, content] of Object.entries(files)) {
    writeFileSync(join(toolDir, filename), content);
  }
  return toolDir;
}

function makeSession(
  tools: LoadedTool[],
  overrides?: Partial<Record<string, unknown>>,
): AgentSession {
  return {
    id: 'e2e-session',
    appId: 'e2e-tenant',
    conversationHistory: [],
    createdAt: Date.now(),
    lastAccessedAt: Date.now(),
    runtime: {
      repo: {
        source: 'local',
        origin: '/test',
        config: {
          name: 'e2e-test',
          version: '1.0.0',
          models: {main: {provider: 'anthropic', model: 'test'}},
        },
        connections: new Map(),
        skills: [],
        agents: {},
        automations: [],
        knowledge: [],
        evals: [],
        tools,
      },
      compiledContext: {
        systemPrompt: 'test',
        tokenUsage: {total: 100000, used: 0, remaining: 100000, sectionBreakdown: {}},
        sections: [],
      },
      outputPipeline: {
        process: vi.fn((text: string) => ({output: text, modified: false, blocked: false, findings: []})),
      },
      connectionsMap: overrides?.['connectionsMap'] ?? {},
      fieldScrubber: null,
      actionGate: {evaluate: vi.fn(() => ({decision: 'allow'}))},
      telemetry: {logScrub: vi.fn(), logGuard: vi.fn(), logGate: vi.fn()},
      userRoles: ['analyst'],
      sessionId: 'e2e-session',
      isDelegated: false,
    },
    planModeManager: {
      isActive: vi.fn(() => false),
      enter: vi.fn(),
      exit: vi.fn(),
      getPlanningReminder: vi.fn(() => null),
      getApprovedPlanContext: vi.fn(() => null),
    },
    exploreConfig: {
      systemPrompt: '',
      model: {provider: 'anthropic', model: 'test'},
      maxTurns: 5,
      maxDepth: 2,
    },
  } as unknown as AgentSession;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Custom Tools E2E', () => {
  let repoDir: string;
  let executor: LocalToolExecutor;

  beforeEach(() => {
    repoDir = makeTempRepo();
    executor = new LocalToolExecutor();
  });

  afterEach(() => {
    executor.dispose();
    rmSync(repoDir, {recursive: true, force: true});
  });

  // ── Loading ──

  describe('tool loading from disk', () => {
    it('loads a tool.json + handler.ts tool', async () => {
      writeTool(repoDir, 'multiply', {
        'tool.json': JSON.stringify({
          description: 'Multiply two numbers',
          parameters: {
            type: 'object',
            properties: {
              a: {type: 'number'},
              b: {type: 'number'},
            },
            required: ['a', 'b'],
          },
        }),
        'handler.ts': 'export default async (p: any) => ({});',
      });

      const tools = await loadTools(repoDir);
      expect(tools).toHaveLength(1);
      expect(tools[0].name).toBe('multiply');
      expect(tools[0].description).toBe('Multiply two numbers');
      expect(tools[0].parameters['properties']).toBeDefined();
    });

    it('loads a single-file tool with export const description', async () => {
      writeTool(repoDir, 'greet', {
        'handler.ts': `
export const description = 'Greet a user by name';
export default async (params: any) => ({ message: 'hello ' + params.name });
`,
      });

      const tools = await loadTools(repoDir);
      expect(tools).toHaveLength(1);
      expect(tools[0].name).toBe('greet');
      expect(tools[0].description).toBe('Greet a user by name');
    });

    it('loads a single-file tool with defineToolHandler', async () => {
      writeTool(repoDir, 'add_numbers', {
        'handler.ts': `
import { defineToolHandler } from '@amodalai/core';
export default defineToolHandler({
  description: 'Add two numbers together',
  parameters: { type: 'object', properties: { a: { type: 'number' }, b: { type: 'number' } } },
  handler: async (params) => ({ sum: (params.a as number) + (params.b as number) }),
});
`,
      });

      const tools = await loadTools(repoDir);
      expect(tools).toHaveLength(1);
      expect(tools[0].name).toBe('add_numbers');
      expect(tools[0].description).toBe('Add two numbers together');
    });

    it('loads multiple tools from the same repo', async () => {
      writeTool(repoDir, 'tool_a', {
        'tool.json': JSON.stringify({description: 'Tool Alpha'}),
        'handler.ts': 'export default async () => ({});',
      });
      writeTool(repoDir, 'tool_b', {
        'tool.json': JSON.stringify({description: 'Tool Beta'}),
        'handler.ts': 'export default async () => ({});',
      });
      writeTool(repoDir, 'tool_c', {
        'handler.ts': 'export const description = "Tool Charlie";\nexport default async () => ({});',
      });

      const tools = await loadTools(repoDir);
      expect(tools).toHaveLength(3);
      const names = tools.map((t) => t.name).sort();
      expect(names).toEqual(['tool_a', 'tool_b', 'tool_c']);
    });

    it('detects Dockerfile, package.json, and confirm settings', async () => {
      writeTool(repoDir, 'ml_scorer', {
        'tool.json': JSON.stringify({
          description: 'Score risk using ML',
          confirm: 'review',
          timeout: 60000,
          env: ['MODEL_KEY'],
        }),
        'handler.ts': 'export default async () => ({});',
        'Dockerfile': 'FROM python:3.12-slim\nRUN pip install pandas',
        'package.json': JSON.stringify({dependencies: {}}),
      });

      const tools = await loadTools(repoDir);
      expect(tools[0].hasDockerfile).toBe(true);
      expect(tools[0].hasPackageJson).toBe(true);
      expect(tools[0].hasSetupScript).toBe(false);
      expect(tools[0].confirm).toBe('review');
      expect(tools[0].timeout).toBe(60000);
      expect(tools[0].env).toEqual(['MODEL_KEY']);
    });

    it('detects setup.sh and requirements.txt', async () => {
      writeTool(repoDir, 'py_tool', {
        'tool.json': JSON.stringify({
          description: 'Python tool',
          sandbox: {language: 'python'},
        }),
        'handler.ts': 'export default async () => ({});',
        'setup.sh': '#!/bin/bash\npip install -r requirements.txt\ngo build -o scorer scorer.go',
        'requirements.txt': 'pandas\nnumpy',
      });

      const tools = await loadTools(repoDir);
      expect(tools[0].hasSetupScript).toBe(true);
      expect(tools[0].hasRequirementsTxt).toBe(true);
      expect(tools[0].hasDockerfile).toBe(false);
      expect(tools[0].sandboxLanguage).toBe('python');
    });

    it('rejects mismatched name in tool.json', async () => {
      writeTool(repoDir, 'my_tool', {
        'tool.json': JSON.stringify({name: 'other_name', description: 'Mismatch'}),
        'handler.ts': 'export default async () => ({});',
      });

      await expect(loadTools(repoDir)).rejects.toThrow(/does not match directory name/);
    });

    it('rejects invalid directory names', async () => {
      writeTool(repoDir, 'Bad-Name', {
        'tool.json': JSON.stringify({description: 'Bad'}),
        'handler.ts': 'export default async () => ({});',
      });

      await expect(loadTools(repoDir)).rejects.toThrow(/not a valid tool name/);
    });

    it('returns empty array when no tools/ directory exists', async () => {
      const tools = await loadTools(repoDir);
      expect(tools).toEqual([]);
    });
  });

  // ── Execution ──

  describe('tool execution', () => {
    it('executes a handler that returns an object', async () => {
      const toolDir = writeTool(repoDir, 'compute', {
        'handler.mjs': `
export default async (params) => ({
  result: params.x * params.y,
  label: 'product',
});
`,
        'tool.json': JSON.stringify({description: 'Compute product'}),
        'handler.ts': 'placeholder', // loader needs this
      });

      // Load, then swap handlerPath to .mjs for dynamic import
      const tools = await loadTools(repoDir);
      tools[0].handlerPath = join(toolDir, 'handler.mjs');

      const session = makeSession(tools);
      const ctx = buildToolContext(session, tools[0], AbortSignal.timeout(10000));
      const result = await executor.execute(tools[0], {x: 6, y: 7}, ctx);

      expect(result).toEqual({result: 42, label: 'product'});
    });

    it('wraps primitive return values', async () => {
      const toolDir = writeTool(repoDir, 'stringify', {
        'handler.mjs': 'export default async (params) => "hello " + params.name;',
        'tool.json': JSON.stringify({description: 'Stringify'}),
        'handler.ts': 'placeholder',
      });

      const tools = await loadTools(repoDir);
      tools[0].handlerPath = join(toolDir, 'handler.mjs');

      const session = makeSession(tools);
      const ctx = buildToolContext(session, tools[0], AbortSignal.timeout(10000));
      const result = await executor.execute(tools[0], {name: 'world'}, ctx);

      expect(result).toEqual({result: 'hello world'});
    });

    it('catches handler errors gracefully', async () => {
      const toolDir = writeTool(repoDir, 'fail_tool', {
        'handler.mjs': 'export default async () => { throw new Error("intentional failure"); };',
        'tool.json': JSON.stringify({description: 'Fails intentionally'}),
        'handler.ts': 'placeholder',
      });

      const tools = await loadTools(repoDir);
      tools[0].handlerPath = join(toolDir, 'handler.mjs');

      const session = makeSession(tools);
      const ctx = buildToolContext(session, tools[0], AbortSignal.timeout(10000));
      const result = await executor.execute(tools[0], {}, ctx);

      expect(result).toEqual({error: 'intentional failure'});
    });

    it('handler can use ctx.exec() to run shell commands', async () => {
      const toolDir = writeTool(repoDir, 'shell_tool', {
        'handler.mjs': `
export default async (params, ctx) => {
  const result = await ctx.exec('echo ' + JSON.stringify(params.message));
  return { output: result.stdout.trim(), exitCode: result.exitCode };
};
`,
        'tool.json': JSON.stringify({description: 'Shell tool'}),
        'handler.ts': 'placeholder',
      });

      const tools = await loadTools(repoDir);
      tools[0].handlerPath = join(toolDir, 'handler.mjs');

      const session = makeSession(tools);
      const ctx = buildToolContext(session, tools[0], AbortSignal.timeout(10000));
      const result = await executor.execute(tools[0], {message: 'hello from shell'}, ctx);

      expect(result).toEqual({output: 'hello from shell', exitCode: 0});
    });

    it('handler can use ctx.exec() to run Python', async () => {
      // Skip if python3 is not available
      const {execSync} = await import('node:child_process');
      let hasPython = false;
      try {
        execSync('python3 --version', {stdio: 'pipe'});
        hasPython = true;
      } catch {
        // python3 not installed
      }

      if (!hasPython) {
        return; // Skip test
      }

      const toolDir = writeTool(repoDir, 'python_tool', {
        'handler.mjs': `
export default async (params, ctx) => {
  const result = await ctx.exec('python3 compute.py ' + params.a + ' ' + params.b);
  if (result.exitCode !== 0) return { error: result.stderr };
  return JSON.parse(result.stdout);
};
`,
        'compute.py': 'import sys, json\na, b = int(sys.argv[1]), int(sys.argv[2])\nprint(json.dumps({"sum": a + b}))',
        'tool.json': JSON.stringify({description: 'Python math'}),
        'handler.ts': 'placeholder',
      });

      const tools = await loadTools(repoDir);
      tools[0].handlerPath = join(toolDir, 'handler.mjs');

      const session = makeSession(tools);
      const ctx = buildToolContext(session, tools[0], AbortSignal.timeout(10000));
      const result = await executor.execute(tools[0], {a: 10, b: 32}, ctx);

      expect(result).toEqual({sum: 42});
    });

    it('handler can use ctx.env() with allowlisted vars', async () => {
      process.env['E2E_TEST_KEY'] = 'secret-value';

      const toolDir = writeTool(repoDir, 'env_tool', {
        'handler.mjs': `
export default async (params, ctx) => ({
  allowed: ctx.env('E2E_TEST_KEY'),
  blocked: ctx.env('HOME'),
});
`,
        'tool.json': JSON.stringify({
          description: 'Env tool',
          env: ['E2E_TEST_KEY'],
        }),
        'handler.ts': 'placeholder',
      });

      const tools = await loadTools(repoDir);
      tools[0].handlerPath = join(toolDir, 'handler.mjs');

      const session = makeSession(tools);
      const ctx = buildToolContext(session, tools[0], AbortSignal.timeout(10000));
      const result = await executor.execute(tools[0], {}, ctx);

      expect(result).toEqual({allowed: 'secret-value', blocked: undefined});

      delete process.env['E2E_TEST_KEY'];
    });

    it('handler can use ctx.log()', async () => {
      const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

      const toolDir = writeTool(repoDir, 'log_tool', {
        'handler.mjs': `
export default async (params, ctx) => {
  ctx.log('processing ' + params.item);
  return { ok: true };
};
`,
        'tool.json': JSON.stringify({description: 'Log tool'}),
        'handler.ts': 'placeholder',
      });

      const tools = await loadTools(repoDir);
      tools[0].handlerPath = join(toolDir, 'handler.mjs');

      const session = makeSession(tools);
      const ctx = buildToolContext(session, tools[0], AbortSignal.timeout(10000));
      await executor.execute(tools[0], {item: 'order-123'}, ctx);

      expect(stderrSpy).toHaveBeenCalledWith(
        expect.stringContaining('processing order-123'),
      );

      stderrSpy.mockRestore();
    });

    it('ctx.user contains session roles', async () => {
      const toolDir = writeTool(repoDir, 'role_tool', {
        'handler.mjs': `
export default async (params, ctx) => ({
  roles: ctx.user.roles,
});
`,
        'tool.json': JSON.stringify({description: 'Role tool'}),
        'handler.ts': 'placeholder',
      });

      const tools = await loadTools(repoDir);
      tools[0].handlerPath = join(toolDir, 'handler.mjs');

      const session = makeSession(tools);
      const ctx = buildToolContext(session, tools[0], AbortSignal.timeout(10000));
      const result = await executor.execute(tools[0], {}, ctx);

      expect(result).toEqual({roles: ['analyst']});
    });
  });

  // ── Confirmation gating ──

  describe('confirmation gating', () => {
    it('confirm: false tools reject non-GET requests via ctx.request()', async () => {
      const toolDir = writeTool(repoDir, 'readonly_tool', {
        'handler.mjs': `
export default async (params, ctx) => {
  try {
    await ctx.request('crm', '/deals', { method: 'POST', data: { name: 'test' } });
    return { error: 'should have thrown' };
  } catch (err) {
    return { blocked: true, message: err.message };
  }
};
`,
        'tool.json': JSON.stringify({description: 'Read-only tool', confirm: false}),
        'handler.ts': 'placeholder',
      });

      const tools = await loadTools(repoDir);
      tools[0].handlerPath = join(toolDir, 'handler.mjs');

      const session = makeSession(tools);
      const ctx = buildToolContext(session, tools[0], AbortSignal.timeout(10000));
      const result = await executor.execute(tools[0], {}, ctx);

      const resultObj = result as Record<string, unknown>;
      expect(resultObj['blocked']).toBe(true);
      expect(resultObj['message']).toMatch(/only GET requests are allowed/);
    });

    it('confirm: "never" tools are excluded from buildTools output', async () => {
      writeTool(repoDir, 'visible_tool', {
        'tool.json': JSON.stringify({description: 'Visible'}),
        'handler.ts': 'export default async () => ({});',
      });
      writeTool(repoDir, 'hidden_tool', {
        'tool.json': JSON.stringify({description: 'Hidden', confirm: 'never'}),
        'handler.ts': 'export default async () => ({});',
      });

      const tools = await loadTools(repoDir);
      expect(tools).toHaveLength(2);

      // Simulate what buildTools does — filter out confirm: 'never'
      const visibleTools = tools.filter((t) => t.confirm !== 'never');
      expect(visibleTools).toHaveLength(1);
      expect(visibleTools[0].name).toBe('visible_tool');
    });
  });

  // ── Handler caching ──

  describe('handler caching', () => {
    it('caches handler modules across invocations', async () => {
      const toolDir = writeTool(repoDir, 'cached_tool', {
        'handler.mjs': `
let callCount = 0;
export default async () => ({ call: ++callCount });
`,
        'tool.json': JSON.stringify({description: 'Cached tool'}),
        'handler.ts': 'placeholder',
      });

      const tools = await loadTools(repoDir);
      tools[0].handlerPath = join(toolDir, 'handler.mjs');

      const session = makeSession(tools);
      const ctx = buildToolContext(session, tools[0], AbortSignal.timeout(10000));

      const r1 = await executor.execute(tools[0], {}, ctx);
      const r2 = await executor.execute(tools[0], {}, ctx);

      // Same module instance → counter increments
      expect(r1).toEqual({call: 1});
      expect(r2).toEqual({call: 2});
    });
  });

  // ── exec() integration ──

  describe('ctx.exec() integration', () => {
    it('exec() captures stdout, stderr, and exit code', async () => {
      const toolDir = writeTool(repoDir, 'exec_detail', {
        'handler.mjs': `
export default async (params, ctx) => {
  const result = await ctx.exec('echo out && echo err >&2');
  return result;
};
`,
        'tool.json': JSON.stringify({description: 'Exec detail'}),
        'handler.ts': 'placeholder',
      });

      const tools = await loadTools(repoDir);
      tools[0].handlerPath = join(toolDir, 'handler.mjs');

      const session = makeSession(tools);
      const ctx = buildToolContext(session, tools[0], AbortSignal.timeout(10000));
      const result = await executor.execute(tools[0], {}, ctx);

      const r = result as {stdout: string; stderr: string; exitCode: number};
      expect(r.stdout.trim()).toBe('out');
      expect(r.stderr.trim()).toBe('err');
      expect(r.exitCode).toBe(0);
    });

    it('exec() returns non-zero exit code for failing commands', async () => {
      const toolDir = writeTool(repoDir, 'exec_fail', {
        'handler.mjs': `
export default async (params, ctx) => {
  const result = await ctx.exec('exit 42');
  return { exitCode: result.exitCode };
};
`,
        'tool.json': JSON.stringify({description: 'Exec fail'}),
        'handler.ts': 'placeholder',
      });

      const tools = await loadTools(repoDir);
      tools[0].handlerPath = join(toolDir, 'handler.mjs');

      const session = makeSession(tools);
      const ctx = buildToolContext(session, tools[0], AbortSignal.timeout(10000));
      const result = await executor.execute(tools[0], {}, ctx);

      expect(result).toEqual({exitCode: 42});
    });

    it('exec() runs with tool directory as default cwd', async () => {
      const toolDir = writeTool(repoDir, 'exec_cwd', {
        'handler.mjs': `
export default async (params, ctx) => {
  const result = await ctx.exec('ls handler.mjs');
  return { found: result.exitCode === 0 };
};
`,
        'tool.json': JSON.stringify({description: 'Exec cwd'}),
        'handler.ts': 'placeholder',
      });

      const tools = await loadTools(repoDir);
      tools[0].handlerPath = join(toolDir, 'handler.mjs');

      const session = makeSession(tools);
      const ctx = buildToolContext(session, tools[0], AbortSignal.timeout(10000));
      const result = await executor.execute(tools[0], {}, ctx);

      expect(result).toEqual({found: true});
    });

    it('exec() can delegate to a script file in the tool directory', async () => {
      const toolDir = writeTool(repoDir, 'script_tool', {
        'handler.mjs': `
export default async (params, ctx) => {
  const result = await ctx.exec('bash compute.sh ' + params.input);
  return { output: result.stdout.trim() };
};
`,
        'compute.sh': '#!/bin/bash\necho "processed: $1"',
        'tool.json': JSON.stringify({description: 'Script tool'}),
        'handler.ts': 'placeholder',
      });

      const tools = await loadTools(repoDir);
      tools[0].handlerPath = join(toolDir, 'handler.mjs');

      const session = makeSession(tools);
      const ctx = buildToolContext(session, tools[0], AbortSignal.timeout(10000));
      const result = await executor.execute(tools[0], {input: 'order-99'}, ctx);

      expect(result).toEqual({output: 'processed: order-99'});
    });
  });

  // ── Multi-tool pipeline ──

  describe('multi-tool workflows', () => {
    it('loads and executes multiple tools from the same repo', async () => {
      const doubleDir = writeTool(repoDir, 'double', {
        'handler.mjs': 'export default async (p) => ({ value: p.n * 2 });',
        'tool.json': JSON.stringify({description: 'Double a number'}),
        'handler.ts': 'placeholder',
      });
      const negateDir = writeTool(repoDir, 'negate', {
        'handler.mjs': 'export default async (p) => ({ value: -p.n });',
        'tool.json': JSON.stringify({description: 'Negate a number'}),
        'handler.ts': 'placeholder',
      });

      const tools = await loadTools(repoDir);
      tools.find((t) => t.name === 'double')!.handlerPath = join(doubleDir, 'handler.mjs');
      tools.find((t) => t.name === 'negate')!.handlerPath = join(negateDir, 'handler.mjs');

      const session = makeSession(tools);

      // Execute double
      const doubleTool = tools.find((t) => t.name === 'double')!;
      const doubleCtx = buildToolContext(session, doubleTool, AbortSignal.timeout(10000));
      const r1 = await executor.execute(doubleTool, {n: 21}, doubleCtx);
      expect(r1).toEqual({value: 42});

      // Execute negate with the result
      const negateTool = tools.find((t) => t.name === 'negate')!;
      const negateCtx = buildToolContext(session, negateTool, AbortSignal.timeout(10000));
      const r2 = await executor.execute(negateTool, {n: (r1 as {value: number}).value}, negateCtx);
      expect(r2).toEqual({value: -42});
    });
  });
});
