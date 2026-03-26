/**
 * @license
 * Copyright 2025 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import {describe, it, expect, vi, beforeEach} from 'vitest';
import type {LoadedTool} from '@amodalai/core';
import {buildToolContext} from './tool-context-builder.js';
import type {AgentSession} from './agent-types.js';

// Mock the request-helper module
const {mockMakeApiRequest} = vi.hoisted(() => ({
  mockMakeApiRequest: vi.fn().mockResolvedValue({output: '{"ok":true}'}),
}));

vi.mock('./request-helper.js', () => ({
  makeApiRequest: mockMakeApiRequest,
}));

function makeTool(overrides: Partial<LoadedTool> = {}): LoadedTool {
  return {
    name: 'test_tool',
    description: 'Test tool',
    parameters: {},
    confirm: false,
    timeout: 5000,
    env: ['ALLOWED_KEY'],
    handlerPath: '/tmp/handler.ts',
    location: '/tmp',
    hasPackageJson: false,
    hasDockerfile: false,
    hasSetupScript: false,
    hasRequirementsTxt: false,
    sandboxLanguage: 'typescript',
    ...overrides,
  };
}

function makeSession(): AgentSession {
  return {
    id: 'test-session',
    runtime: {
      repo: {
        config: {name: 'test', version: '1.0.0', models: {main: {provider: 'anthropic', model: 'test'}}},
        connections: new Map(),
        skills: [],
        agents: {},
        automations: [],
        knowledge: [],
        evals: [],
        tools: [],
      },
      connectionsMap: {},
      userRoles: ['analyst'],
      fieldScrubber: null,
      telemetry: {logScrub: vi.fn()},
      actionGate: {evaluate: vi.fn()},
      outputPipeline: {process: vi.fn()},
      compiledContext: {systemPrompt: '', tokenUsage: {total: 0, used: 0, remaining: 0, sectionBreakdown: {}}, sections: []},
    },
    tenantId: 'test-tenant',
    conversationHistory: [],
    createdAt: Date.now(),
    lastAccessedAt: Date.now(),
    planModeManager: {isActive: vi.fn(() => false), enter: vi.fn(), exit: vi.fn(), getPlanningReminder: vi.fn(), getApprovedPlanContext: vi.fn()},
    exploreConfig: {model: {provider: 'anthropic', model: 'test'}, maxTurns: 5, maxDepth: 2, systemPrompt: ''},
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any as AgentSession;
}

describe('buildToolContext', () => {
  const signal = AbortSignal.timeout(10000);

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('provides user roles', () => {
    const session = makeSession();
    const ctx = buildToolContext(session, makeTool(), signal);
    expect(ctx.user.roles).toEqual(['analyst']);
  });

  it('provides env() that respects allowlist', () => {
    process.env['ALLOWED_KEY'] = 'secret-value';
    process.env['BLOCKED_KEY'] = 'blocked-value';

    const ctx = buildToolContext(makeSession(), makeTool(), signal);

    expect(ctx.env('ALLOWED_KEY')).toBe('secret-value');
    expect(ctx.env('BLOCKED_KEY')).toBeUndefined();

    delete process.env['ALLOWED_KEY'];
    delete process.env['BLOCKED_KEY'];
  });

  it('provides log() that writes to stderr', () => {
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const ctx = buildToolContext(makeSession(), makeTool(), signal);

    ctx.log('hello world');
    expect(stderrSpy).toHaveBeenCalledWith(expect.stringContaining('hello world'));

    stderrSpy.mockRestore();
  });

  it('provides an abort signal', () => {
    const ctx = buildToolContext(makeSession(), makeTool(), signal);
    expect(ctx.signal).toBeDefined();
    expect(ctx.signal.aborted).toBe(false);
  });

  it('rejects non-GET requests when confirm is false', async () => {
    const ctx = buildToolContext(makeSession(), makeTool({confirm: false}), signal);

    await expect(ctx.request('crm', '/deals', {method: 'POST'})).rejects.toThrow(
      /only GET requests are allowed/,
    );
  });

  it('allows non-GET requests when confirm is true', async () => {
    mockMakeApiRequest.mockResolvedValueOnce({output: '{"ok":true}'});
    const ctx = buildToolContext(makeSession(), makeTool({confirm: true}), signal);

    const result = await ctx.request('crm', '/deals', {method: 'POST'});
    expect(result).toEqual({ok: true});
    expect(mockMakeApiRequest).toHaveBeenCalledOnce();
  });

  it('allows GET requests when confirm is false', async () => {
    mockMakeApiRequest.mockResolvedValueOnce({output: '{"ok":true}'});
    const ctx = buildToolContext(makeSession(), makeTool({confirm: false}), signal);

    const result = await ctx.request('crm', '/deals');
    expect(result).toEqual({ok: true});
    expect(mockMakeApiRequest).toHaveBeenCalledOnce();
  });

  it('provides exec() that runs shell commands', async () => {
    const ctx = buildToolContext(makeSession(), makeTool(), signal);
    const result = await ctx.exec('echo "hello from exec"');
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe('hello from exec');
  });

  it('exec() captures non-zero exit codes', async () => {
    const ctx = buildToolContext(makeSession(), makeTool(), signal);
    const result = await ctx.exec('exit 42');
    expect(result.exitCode).toBe(42);
  });

  it('exec() uses tool location as default cwd', async () => {
    const ctx = buildToolContext(makeSession(), makeTool({location: '/tmp'}), signal);
    const result = await ctx.exec('pwd');
    // macOS: /tmp is a symlink to /private/tmp
    expect(result.stdout.trim()).toMatch(/\/?tmp$/);
  });

  it('exec() delegates to session.shellExecutor when present', async () => {
    const mockShellExecutor = {
      exec: vi.fn().mockResolvedValue({stdout: 'sandbox output', stderr: '', exitCode: 0}),
    };
    const session = makeSession();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (session as any).shellExecutor = mockShellExecutor;

    const ctx = buildToolContext(session, makeTool(), signal);
    const result = await ctx.exec('echo hello');

    expect(result.stdout).toBe('sandbox output');
    expect(result.exitCode).toBe(0);
    expect(mockShellExecutor.exec).toHaveBeenCalledWith(
      'echo hello',
      5000,
      expect.any(AbortSignal),
    );
  });

  it('exec() falls back to local when no shellExecutor', async () => {
    const session = makeSession();
    // No shellExecutor set
    const ctx = buildToolContext(session, makeTool(), signal);
    const result = await ctx.exec('echo "local fallback"');

    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe('local fallback');
  });
});
