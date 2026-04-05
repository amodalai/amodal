/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import {describe, it, expect, vi, beforeEach, afterEach} from 'vitest';
import {ProactiveRunner} from './proactive-runner.js';
import type {AgentBundle, LoadedAutomation} from '@amodalai/core';
import type {Session} from '../../session/types.js';
import {SSEEventType} from '../../types.js';
import {createLogger} from '../../logger.js';

const logger = createLogger({component: 'test:proactive-runner'});

// Mock delivery
const {mockDeliverResult} = vi.hoisted(() => ({
  mockDeliverResult: vi.fn(),
}));

vi.mock('./delivery.js', () => ({
  deliverResult: mockDeliverResult,
}));

function makeAutomation(overrides?: Partial<LoadedAutomation>): LoadedAutomation {
  return {
    name: 'test-auto',
    title: 'Test Automation',
    trigger: 'cron',
    schedule: '0 9 * * *',
    prompt: 'Check systems.',
    location: 'automations/test.json',
    ...overrides,
  };
}

function makeRepo(automations: LoadedAutomation[]): AgentBundle {
  return {
    source: 'local',
    origin: '/test',
    config: {
      name: 'test',
      version: '1.0',
      models: {main: {provider: 'anthropic', model: 'claude-sonnet-4-20250514'}},
    },
    connections: new Map(),
    skills: [],
    agents: {subagents: []},
    automations,
    knowledge: [],
    evals: [],
    tools: [],
    stores: [],
  };
}

// Mock session and session manager
const mockSession: Session = {
  id: 'test-session',
  provider: {} as Session['provider'],
  toolRegistry: {register: vi.fn(), get: vi.fn(), getTools: vi.fn(), names: vi.fn(() => []), subset: vi.fn(), size: 0},
  permissionChecker: {check: vi.fn()},
  logger,
  systemPrompt: 'test',
  messages: [],
  usage: {inputTokens: 0, outputTokens: 0, totalTokens: 0},
  model: 'test-model',
  providerName: 'test',
  userRoles: [],
  appId: 'local',
  metadata: {},
  createdAt: Date.now(),
  lastAccessedAt: Date.now(),
  maxTurns: 50,
  maxContextTokens: 200_000,
};

const mockToolContextFactory = vi.fn();

function makeRunMessageMock() {
  return vi.fn().mockImplementation(async function* () {
    yield {type: SSEEventType.TextDelta, content: 'Test response', timestamp: new Date().toISOString()};
    yield {type: SSEEventType.Done, timestamp: new Date().toISOString()};
  });
}

function makeSessionManager(runMessageImpl?: ReturnType<typeof vi.fn>) {
  return {
    create: vi.fn().mockReturnValue(mockSession),
    get: vi.fn(),
    has: vi.fn(),
    resume: vi.fn(),
    destroy: vi.fn().mockResolvedValue(undefined),
    persist: vi.fn().mockResolvedValue(undefined),
    listPersisted: vi.fn(),
    start: vi.fn(),
    shutdown: vi.fn(),
    cleanup: vi.fn(),
    runMessage: runMessageImpl ?? makeRunMessageMock(),
    size: 0,
  };
}

import type {ProactiveRunnerConfig} from './proactive-runner.js';

 
function makeConfig(overrides?: Record<string, unknown>): ProactiveRunnerConfig {
  const sm = makeSessionManager();
  return {
    sessionManager: sm,
    createSessionComponents: vi.fn().mockReturnValue({
      session: mockSession,
      toolContextFactory: mockToolContextFactory,
    }),
    logger,
    ...overrides,
  } as unknown as ProactiveRunnerConfig;
}

describe('ProactiveRunner', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockDeliverResult.mockResolvedValue(true);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should list automations with running state', () => {
    const repo = makeRepo([
      makeAutomation({name: 'a1'}),
      makeAutomation({name: 'a2', trigger: 'webhook', schedule: undefined, prompt: 'Run on webhook.'}),
    ]);

    const runner = new ProactiveRunner(repo, makeConfig());

    const list = runner.listAutomations();
    expect(list).toHaveLength(2);
    expect(list[0]?.name).toBe('a1');
    expect(list[0]?.running).toBe(false);
    expect(list[1]?.name).toBe('a2');
    expect(list[1]?.running).toBe(true);
  });

  it('should start and stop individual cron automations', () => {
    const repo = makeRepo([
      makeAutomation({name: 'cron-a', schedule: '*/5 * * * *'}),
      makeAutomation({name: 'cron-b', schedule: '*/10 * * * *'}),
    ]);

    const runner = new ProactiveRunner(repo, makeConfig());

    const startResult = runner.startAutomation('cron-a');
    expect(startResult.success).toBe(true);

    const list = runner.listAutomations();
    expect(list.find((a) => a.name === 'cron-a')?.running).toBe(true);
    expect(list.find((a) => a.name === 'cron-b')?.running).toBe(false);

    const stopResult = runner.stopAutomation('cron-a');
    expect(stopResult.success).toBe(true);
    expect(runner.listAutomations().find((a) => a.name === 'cron-a')?.running).toBe(false);
  });

  it('should reject starting unknown automation', () => {
    const repo = makeRepo([]);
    const runner = new ProactiveRunner(repo, makeConfig());

    const result = runner.startAutomation('unknown');
    expect(result.success).toBe(false);
    expect(result.error).toContain('not found');
  });

  it('should reject starting already running automation', () => {
    const repo = makeRepo([makeAutomation({name: 'a', schedule: '*/5 * * * *'})]);
    const runner = new ProactiveRunner(repo, makeConfig());

    runner.startAutomation('a');
    const result = runner.startAutomation('a');
    expect(result.success).toBe(false);
    expect(result.error).toContain('already running');

    runner.stop();
  });

  it('should reject starting webhook-triggered automation', () => {
    const repo = makeRepo([makeAutomation({name: 'hook', trigger: 'webhook', schedule: undefined, prompt: 'Run on webhook.'})]);
    const runner = new ProactiveRunner(repo, makeConfig());

    const result = runner.startAutomation('hook');
    expect(result.success).toBe(false);
    expect(result.error).toContain('webhook-triggered');
  });

  it('should reject stopping automation that is not running', () => {
    const repo = makeRepo([makeAutomation({name: 'a'})]);
    const runner = new ProactiveRunner(repo, makeConfig());

    const result = runner.stopAutomation('a');
    expect(result.success).toBe(false);
    expect(result.error).toContain('not running');
  });

  it('start() should start all cron automations', () => {
    const repo = makeRepo([
      makeAutomation({name: 'cron-a', schedule: '*/5 * * * *'}),
      makeAutomation({name: 'cron-b', schedule: '*/10 * * * *'}),
      makeAutomation({name: 'hook', trigger: 'webhook', schedule: undefined, prompt: 'Run on webhook.'}),
    ]);

    const runner = new ProactiveRunner(repo, makeConfig());
    runner.start();

    const list = runner.listAutomations();
    expect(list.find((a) => a.name === 'cron-a')?.running).toBe(true);
    expect(list.find((a) => a.name === 'cron-b')?.running).toBe(true);

    runner.stop();
  });

  it('stop() should stop all cron automations', () => {
    const repo = makeRepo([
      makeAutomation({name: 'cron-a', schedule: '*/5 * * * *'}),
    ]);

    const runner = new ProactiveRunner(repo, makeConfig());
    runner.start();
    runner.stop();

    expect(runner.listAutomations().find((a) => a.name === 'cron-a')?.running).toBe(false);
  });

  it('should handle webhook for webhook-triggered automation', async () => {
    const repo = makeRepo([
      makeAutomation({
        name: 'webhook-auto',
        trigger: 'webhook',
        schedule: undefined,
        prompt: 'Run on webhook when alert fires.',
      }),
    ]);

    const runner = new ProactiveRunner(repo, makeConfig());
    const result = await runner.handleWebhook('webhook-auto', {alert: 'high-cpu'});
    expect(result.matched).toBe(true);
  });

  it('should return not matched for unknown automation', async () => {
    const repo = makeRepo([]);
    const runner = new ProactiveRunner(repo, makeConfig());

    const result = await runner.handleWebhook('unknown', {});
    expect(result.matched).toBe(false);
    expect(result.error).toContain('not found');
  });

  it('should return not matched for non-webhook automation', async () => {
    const repo = makeRepo([makeAutomation({name: 'cron-only'})]);
    const runner = new ProactiveRunner(repo, makeConfig());

    const result = await runner.handleWebhook('cron-only', {});
    expect(result.matched).toBe(false);
    expect(result.error).toContain('not webhook-triggered');
  });

  it('should trigger automation manually', async () => {
    const repo = makeRepo([makeAutomation({name: 'manual'})]);
    const runner = new ProactiveRunner(repo, makeConfig());

    const result = await runner.triggerAutomation('manual');
    expect(result.success).toBe(true);
  });

  it('should return error when triggering unknown automation', async () => {
    const repo = makeRepo([]);
    const runner = new ProactiveRunner(repo, makeConfig());

    const result = await runner.triggerAutomation('unknown');
    expect(result.success).toBe(false);
    expect(result.error).toContain('not found');
  });

  it('should destroy session after automation run', async () => {
    const config = makeConfig();
    const repo = makeRepo([makeAutomation({name: 'cleanup-test'})]);
    const runner = new ProactiveRunner(repo, config);

    await runner.triggerAutomation('cleanup-test');
    expect(config.sessionManager.destroy).toHaveBeenCalledWith('test-session');
  });

  it('should indicate webhook-triggered automations in list', () => {
    const repo = makeRepo([
      makeAutomation({name: 'cron', prompt: 'Scheduled check.'}),
      makeAutomation({name: 'hook', trigger: 'webhook', schedule: undefined, prompt: 'Run on webhook.'}),
    ]);

    const runner = new ProactiveRunner(repo, makeConfig());

    const list = runner.listAutomations();
    const cron = list.find((a) => a.name === 'cron');
    const hook = list.find((a) => a.name === 'hook');
    expect(cron?.webhookTriggered).toBe(false);
    expect(hook?.webhookTriggered).toBe(true);
  });
});
