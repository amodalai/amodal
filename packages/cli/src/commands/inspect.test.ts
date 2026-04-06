/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import {describe, it, expect, vi, beforeEach, afterEach} from 'vitest';

const mockFindRepoRoot = vi.fn(() => '/test/repo');
const mockResolveAllPackages = vi.fn();

vi.mock('../shared/repo-discovery.js', () => ({
  findRepoRoot: mockFindRepoRoot,
}));

vi.mock('@amodalai/core', () => ({
  resolveAllPackages: mockResolveAllPackages,
  loadRepo: vi.fn().mockResolvedValue({
    config: {models: {main: {provider: 'anthropic', model: 'test'}}},
    connections: new Map([['crm', {spec: {auth: {type: 'bearer'}}, surface: [{}, {}]}]]),
    skills: [{name: 'triage'}],
    automations: [],
    knowledge: [],
    evals: [],
    tools: [],
  }),
  setupSession: vi.fn(() => ({
    compiledContext: {
      systemPrompt: 'test prompt',
      tokenUsage: {total: 100000, used: 1000, remaining: 99000, sectionBreakdown: {}},
      sections: [
        {name: 'core', content: 'Core content here', tokens: 500, priority: 10, trimmed: false},
        {name: 'skills', content: 'Skill content here', tokens: 500, priority: 5, trimmed: false},
      ],
    },
    exploreContext: {
      systemPrompt: 'explore prompt',
      tokenUsage: {total: 100000, used: 400, remaining: 99600, sectionBreakdown: {}},
      sections: [{name: 'explore-core', content: 'x', tokens: 400, priority: 10, trimmed: false}],
    },
    repo: {
      connections: new Map([['crm', {spec: {auth: {type: 'bearer'}}, surface: [{}, {}]}]]),
    },
  })),
}));

describe('runInspect', () => {
  let stdoutOutput: string[];
  let stderrOutput: string[];
  let origStdout: typeof process.stdout.write;
  let origStderr: typeof process.stderr.write;

  beforeEach(() => {
    vi.clearAllMocks();
    mockFindRepoRoot.mockReturnValue('/test/repo');
    stdoutOutput = [];
    stderrOutput = [];
    origStdout = process.stdout.write;
    origStderr = process.stderr.write;
    process.stdout.write = ((chunk: string) => {
      stdoutOutput.push(String(chunk));
      return true;
    }) as typeof process.stdout.write;
    process.stderr.write = ((chunk: string) => {
      stderrOutput.push(String(chunk));
      return true;
    }) as typeof process.stderr.write;
  });

  afterEach(() => {
    process.stdout.write = origStdout;
    process.stderr.write = origStderr;
  });

  it('should output section information', async () => {
    const {runInspect} = await import('./inspect.js');
    await runInspect();

    const output = stdoutOutput.join('');
    expect(output).toContain('Compiled Context');
    expect(output).toContain('core');
  });

  it('should output connections', async () => {
    const {runInspect} = await import('./inspect.js');
    await runInspect({connections: true});

    const output = stdoutOutput.join('');
    expect(output).toContain('crm');
  });

  it('should output explore context', async () => {
    const {runInspect} = await import('./inspect.js');
    await runInspect({explore: true});

    const output = stdoutOutput.join('');
    expect(output).toContain('Explore Context');
  });

  it('should output tools', async () => {
    const {runInspect} = await import('./inspect.js');
    await runInspect({tools: true});

    const output = stdoutOutput.join('');
    expect(output).toContain('request');
    expect(output).toContain('explore');
  });

  it('should handle repo not found', async () => {
    mockFindRepoRoot.mockImplementation(() => {
      throw new Error('Not found');
    });

    const {runInspect} = await import('./inspect.js');
    await runInspect();

    const output = stderrOutput.join('');
    expect(output).toContain('Not found');
  });

  it('should show section content when context flag is set', async () => {
    const {runInspect} = await import('./inspect.js');
    await runInspect({context: true});

    const output = stdoutOutput.join('');
    expect(output).toContain('Core content here');
  });

  // Resolved package tests
  it('should show resolved packages when resolved flag set', async () => {
    mockResolveAllPackages.mockResolvedValue({
      connections: new Map([['salesforce', {surface: [{}, {}, {}], spec: {auth: {type: 'bearer'}}}]]),
      skills: [{name: 'triage', body: 'Triage methodology content'}],
      automations: [{name: 'daily-scan'}],
      knowledge: [],
      warnings: [],
    });

    const {runInspect} = await import('./inspect.js');
    await runInspect({resolved: true});

    const output = stdoutOutput.join('');
    expect(output).toContain('Resolved Packages');
    expect(output).toContain('salesforce');
    expect(output).toContain('triage');
  });

  it('should filter by scope', async () => {
    mockResolveAllPackages.mockResolvedValue({
      connections: new Map([
        ['salesforce', {surface: [{}, {}], spec: {auth: {type: 'bearer'}}}],
        ['stripe', {surface: [{}], spec: {auth: {type: 'api_key'}}}],
      ]),
      skills: [{name: 'triage', body: 'content'}],
      automations: [],
      knowledge: [],
      warnings: [],
    });

    const {runInspect} = await import('./inspect.js');
    await runInspect({resolved: true, scope: 'connections/salesforce'});

    const output = stdoutOutput.join('');
    expect(output).toContain('salesforce');
    expect(output).not.toContain('stripe');
  });

  it('should show resolution warnings', async () => {
    mockResolveAllPackages.mockResolvedValue({
      connections: new Map(),
      skills: [],
      automations: [],
      knowledge: [],
      warnings: ['Package connection/old is in lock file but not installed'],
    });

    const {runInspect} = await import('./inspect.js');
    await runInspect({resolved: true});

    const output = stdoutOutput.join('');
    expect(output).toContain('Warnings');
    expect(output).toContain('not installed');
  });

  it('should show connection details in resolved view', async () => {
    mockResolveAllPackages.mockResolvedValue({
      connections: new Map([['crm', {surface: [{}, {}], spec: {auth: {type: 'oauth2'}}}]]),
      skills: [],
      automations: [],
      knowledge: [],
      warnings: [],
    });

    const {runInspect} = await import('./inspect.js');
    await runInspect({resolved: true});

    const output = stdoutOutput.join('');
    expect(output).toContain('Endpoints: 2');
    expect(output).toContain('oauth2');
  });

  it('should show skill body length in resolved view', async () => {
    mockResolveAllPackages.mockResolvedValue({
      connections: new Map(),
      skills: [{name: 'investigate', body: 'A'.repeat(500)}],
      automations: [],
      knowledge: [],
      warnings: [],
    });

    const {runInspect} = await import('./inspect.js');
    await runInspect({resolved: true});

    const output = stdoutOutput.join('');
    expect(output).toContain('500 chars');
  });
});
